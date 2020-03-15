/*
References:
  - https://www.reddit.com/r/Gameboy/comments/29o7rx/what_does_dmg_mean/
  - https://gbdev.gg8.se/wiki/articles/Gameboy_Bootstrap_ROM

*/

/*
The first 255: number; area in the Gameboy address space is reserved for Interrupt Vectors and Restart Vectors

$0100-$014F - Cartridge Header Area
	$0100-$0103	NOP / JP $0150
	$0104-$0133	Nintendo Logo
	$0134-$013E	Game Title (Uppercase ASCII)
	$013F-$0142	4-byte Game Designation
	$0143	Color Compatibility byte;
	$0144-$0145	New Licensee Code
	$0146	SGB Compatibility byte;
	$0147	Cart Type
	$0148	Cart ROM size
	$0149	Cart RAM size
	$014A	Destination code
	$014B	Old Licensee code
	$014C	Mask ROM version
	$014D	Complement checksum
	$014E-$014F	Checksum
$0150-$3FFF - ROM Bank 0
$4000-$7FFF - ROM Bank n
$8000-$97FF - Character RAM
*/
const RAM_SIZE_IN_BYTES = 65536;
const ROM_BANK_END_ADDR = 32767;
// The boot rom is readable while booting but afterwards the address space of the ROM is remapped for interrupt vectors and other uses.

class Memory {
  public ram: Uint8Array;

  constructor() {
      this.ram = new Uint8Array(RAM_SIZE_IN_BYTES);
  }

  public write(addr: number, value: number) {
    this.ram[addr] = value;
  }

  public read(addr: number): number {
    return this.ram[addr];
  }
}

class MemoryBus {
    private memory: Memory;
    private ppu: PPU;

    constructor(memory: Memory, ppu: PPU) {
        this.memory = memory;
        this.ppu = ppu;
    }

    public writeByte(addr: number, value: number) {
        // if writing to memory mapped vram
        if (addr >= VRAM_ADDR_BEGIN && addr <= VRAM_ADDR_END) {
            this.ppu.writeToVRAM(addr - VRAM_ADDR_BEGIN, value);
        } else if (addr >= OAM_ADDR_BEGIN && addr <= OAM_ADDR_END) {
            this.ppu.writeToOAM(addr - OAM_ADDR_BEGIN, value);
        } else if (addr === LY_ADDR) {
            // ignore
        } else {
            this.memory.write(addr, value);
        }
    }

    public readByte(addr: number): number {
        if (addr >= VRAM_ADDR_BEGIN && addr <= VRAM_ADDR_END) {
            return this.ppu.readFromVRAM(addr - VRAM_ADDR_BEGIN);
        } else if (addr >= OAM_ADDR_BEGIN && addr <= OAM_ADDR_END) {
            return this.ppu.readFromOAM(addr - OAM_ADDR_BEGIN);
        } else if (addr === LY_ADDR) {
            console.log("READ the LY special register");
            return this.ppu.LY;
        } else {
            return this.memory.read(addr);
        }
    }
}

const ZERO_FLAG: number = 0x7F; // set when the instruction results in a value of 0. Otherwise (result different to 0) it is cleared.
const SUBTRACTION_FLAG: number = 0xBF; // set when the instruction is a subtraction.  Otherwise (the instruction is an addition) it is cleared.
const HALF_CARRY_FLAG: number = 0xDF; // set when a carry from bit 3 is produced in arithmetical instructions.  Otherwise it is cleared.
const CARRY_FLAG: number = 0xEF; // set when a carry from bit 7 is produced in arithmetical instructions.  Otherwise it is cleared.

const wrappingByteAdd = (value1: number, value2: number): [number, boolean] => {
    const value = (value1 + value2);
    if (value >= 256) {
        return [value % 256, true];
    } else {
        return [value, false];
    }
}

const wrappingTwoByteAdd = (value1: number, value2: number): [number, boolean] => {
    const value = (value1 + value2);
    if (value >= 65536) {
        return [value % 65536, true];
    } else {
        return [value, false];
    }
}

const wrappingByteSub = (value1: number, value2: number): [number, boolean] => {
    const result = (value1 - value2) % 256;
    return result >= 0 ? [result, false] : [256 + result, true];
}

const wrappingTwoByteSub = (value1: number, value2: number): [number, boolean] => {
    const result = (value1 - value2) % 65536;
    return result >= 0 ? [result, false] : [65536 + result, true];
}

const bitNegation = (value: number): number => {
    let binaryString: string = value.toString(2);
    let negatedBinary: string = "";
    for (let i = 0; i < binaryString.length; i++) {
        negatedBinary += binaryString[i] === '1' ? '0' : '1';
    }
    return parseInt(negatedBinary, 2);
}

const makeSigned = (value: number, bytesCount: number): number => {
  let msbMask: number = 0x80;
  if (bytesCount === 2) {
      msbMask = 0x8000;
  }
  
  if ((value & msbMask) > 0) {
    // value is negative
    return -(bitNegation(value) + 1);
  }

  return value;
}


class CPU {
	// registers (unless specified all registers are assumed to be 1 byte)
	A: number;
	B: number;
	C: number;
	D: number;
	E: number; 
	F: number; // flags register
	//H: number;
    //L: number;
    HL: number; // 2 bytes
	SP: number; // 2 bytes. register points to the current stack position
    PC: number; // 2 bytes

    IME: number; //=0
    IF: number; //=0xe0
    IE: number; //=0x00

	// Reference to RAM
    bus: MemoryBus;
    
    constructor(bus: MemoryBus) {
        this.bus = bus;
        this.A = 0;
        this.B = 0;
        this.C = 0;
        this.D = 0;
        this.E = 0;
        this.F = 0;
    }

    public initAfterRomLoaded() {
        this.PC = 0x100;  // starting address in the rom. The instruction at this address should be a JMP that jumps to the first
                          // actual instruction to be executed.
        this.SP = 0xFFFE;

        // initialize Interrupt related flag registers
        this.IME = 0x00;
        this.IF = 0xE0;
        this.IE = 0x00;
    }

    public H(): number {
        return (this.HL & 0xFF00) >> 8;
    }

    // decrement the H portion of HL register by 1
    public decrementH() {
      const result = wrappingByteSub(this.H(), 1);
      this.HL = (result[0] << 8) | this.L();
    }

    public L(): number {
        return this.HL & 0x00FF;
    }

    public DE(): number {
        return (this.D << 8) | this.E;
    }

    public getFlag(flag: number): boolean {
        let flagValue = this.F & ~flag;
        while (flagValue > 1) {
            flagValue >>= 1;
        }

        return flagValue === 1;
    }

    public clearFlag(flag: number) {
      this.F = this.F & flag;
    }

    public setFlag(flag: number) {
        this.F = this.F | ~flag;
    }

    public getRegisterVal(regId: number): number {
        if (regId == 0x00) {
            return this.B;
        } else if (regId == 0x01) {
            return this.C;
        } else if (regId == 0x02) {
            return this.D;
        } else if (regId == 0x03) {
            return this.E;
        } else if (regId == 0x04) {
            return this.H();
        } else if (regId == 0x05) {
            return this.L();
        } else if (regId == 0x06) {
            return 0; // TODO: return value at address pointed to HL
        } else if (regId == 0x07) {
            return this.A;
        }
    
        // should never get here
        return 0
    }

    // Due to JMP, RET instructions this fn must modify the PC register itself.
    // The return value is the number of cycles the instruction took
    // Instruction cycle counts can be found here: http://www.pastraiser.com/cpu/gameboy/gameboy_opcodes.html
    // @return cyclesConsumed: number = The number of cycles the just executed instruction took
    public executeInstruction(): number {
        const currByte = this.bus.readByte(this.PC);
    	if (currByte === 0x31) {
            // LD SP, N
            // 3 byte instruction
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb >> 8) & lsb;
            this.SP = addr;
            this.PC += 3;

            return 12;
        } else if (currByte === 0x00) {
          // NOP
          console.log("NOP");
          this.PC++;
          return 4;
        } else if (currByte === 0xC3) {
            // JP 2-byte-address
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            console.log(`JP ${addr} [${msb}{${msb<<8}} ${lsb}]`);
            this.PC = addr;
            return 16;
        } else if (currByte === 0xAF) {
            // XOR A  (1 byte, 4 cycles)
            this.A = this.A ^ this.A;
            this.updateZeroFlag(this.A);

            console.log("XOR A");
            this.PC++;
            return 4;
        } else if (currByte === 0x21) {
            // LD HL,d16 (3 bytes, 12 cycles)
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const value = (msb << 8) | lsb;
            this.HL = value;
            console.log(`LD HL, ${value}`);

            this.PC += 3;
            return 12;
        } else if (currByte === 0x0E) {
            // LD C,d8
            const value = this.bus.readByte(this.PC + 1);
            this.C = value;
            console.log(`LD C, ${value}`);
            this.PC += 2;
            return 8;
        } else if (currByte === 0x06) {
            // LD B,d8
            const value = this.bus.readByte(this.PC + 1);
            this.B = value;
            console.log(`LD B, ${value}`);
            this.PC += 2;
            return 8;
        } else if (currByte === 0x32) {
            // Put A into memory address HL. Decrement HL.
            // LD (HL-),A
            this.bus.writeByte(this.HL, this.A);
            const result = wrappingTwoByteSub(this.HL, 1);
            this.HL = result[0];
            console.log("LD (HL-), A");

            this.PC++;
            return 8;
        } else if (currByte === 0x05) {
            // DEC B
            console.log("DEC B");

            // TODO: Verify is wrapping is correct behavior for DEC B instruction. Also, how is the Zero flag
            //       suppossed to be updated?
            const result = wrappingByteSub(this.B, 1);
            this.updateHalfCarryFlag(this.B, 1);
            this.B = result[0];
            this.setFlag(SUBTRACTION_FLAG);

            // TODO: Appears this isnt updating the zero flag
            this.updateZeroFlag(this.B);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x20) {
            // branch if not zero
            // JR NotZero,r8

            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2;
            if (!this.getFlag(ZERO_FLAG)) {

                console.log(`[${this.PC}]: JR NZ, ${offset} [jumped]`);
                this.PC += offset;
                return 12;
            } else {
                console.log(`[${this.PC}]: JR NZ, ${offset} [not jumped]`);
                return 8;
            }
        } else if (currByte === 0x0D) {
            // DEC C
            console.log(`[${this.PC}]: DEC C`);

            const result = wrappingByteSub(this.C, 1);
            this.updateHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.C);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x1D) {
            // DEC E
            console.log(`[${this.PC}]: DEC E`);

            const result = wrappingByteSub(this.E, 1);
            this.updateHalfCarryFlag(this.E, 1);
            this.E = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.E);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x16) {
            // LD D,d8
            const value = this.bus.readByte(this.PC + 1);
            this.D = value;
            console.log(`LD D, ${value}`);

            this.PC += 2;
            return 8;
        } else if (currByte === 0x1F) {
            // Rotate A right through Carry flag.
            // RRA
            console.log("RRA");
            const newCarryValue = (this.A & 0x01) !== 0;
            const oldCarryValue = this.getFlag(CARRY_FLAG) ? 0x01 : 0x00;
            this.A = (this.A >> 1) | (oldCarryValue << 7);
            if (newCarryValue) {
                this.setFlag(CARRY_FLAG);
            } else {
                this.clearFlag(CARRY_FLAG);
            }
            this.clearFlag(ZERO_FLAG);
            this.clearFlag(HALF_CARRY_FLAG);
            this.clearFlag(SUBTRACTION_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x25) {
            // DEC H
            console.log("DEC H");
            this.decrementH();
            this.PC++;
            return 4;
        } else if (currByte === 0x15) {
            // DEC D
            console.log("DEC D");
            const result = wrappingByteSub(this.D, 1);
            this.updateHalfCarryFlag(this.D, 1);
            this.D = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.D);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0xB0) {
            // Logical OR register B with register A, result in A.
            // OR B
            console.log("OR B");
            this.A = this.A | this.B
            this.PC++;
            return 4;
        } else if (currByte === 0x14) {
            // INC D
            console.log("INC D");
            let result = wrappingByteAdd(this.D, 1);
            // check for half-carry
            this.updateHalfCarryFlag(this.D, 1);
            this.D = result[0]; 
            
            this.updateZeroFlag(this.D);
            this.clearFlag(SUBTRACTION_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x7B) {
            // LD A,E
            console.log("LD A, E");
            this.A = this.E;
            this.PC++;
            return 4;
        } else if (currByte === 0xBF) {
            // compare A with A. Set flags as if they are equal
            // CP A
            console.log("CP A");
            this.setFlag(ZERO_FLAG);
            this.setFlag(SUBTRACTION_FLAG);
            this.clearFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x29) {
            // ADD HL,HL
            console.log("ADD HL, HL");
            const result = wrappingTwoByteAdd(this.HL, this.HL);
            this.updateHalfCarryFlag(this.HL, this.HL);
            this.HL = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 8;
        } else if (currByte === 0x19) {
            // ADD HL,DE
            console.log("ADD HL, DE");
            const result = wrappingTwoByteAdd(this.HL, this.DE());
            this.updateHalfCarryFlag(this.HL, this.DE());
            this.HL = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 8;
        } else if (currByte === 0x77) {
            // LD (HL),A
            console.log("LD (HL), A");
            this.bus.writeByte(this.HL, this.A);
            this.PC++;
            return 8;
        } else if (currByte === 0x07) {
            // RLCA
            console.log("RLCA [NOT IMPL]");
            this.PC++;
            return 4;
        } else if (currByte === 0x08) {
            // LD (a16),SP
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            this.bus.writeByte(addr, this.SP);

            console.log(`LD (${addr}), SP`);
            this.PC += 3;
            return 20;
        } else if (currByte === 0x12) {
            // LD (DE), A
            this.bus.writeByte(this.DE(), this.A);

            console.log("LD (DE), A");
            this.PC++;
            return 8;
        } else if (currByte === 0x0C) {
            // INC C
            const result = wrappingTwoByteAdd(this.C, 1);
            this.updateHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            this.clearFlag(CARRY_FLAG);
            console.log("INC C");
            this.PC++;
            return 4;
        } else if (currByte === 0xD2) {
            // JP NC, a16
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            if (!this.getFlag(CARRY_FLAG)) {
                this.PC = addr;
                console.log(`JP NC, ${addr} [jumped]`);
                return 16;
            } else {
                console.log(`JP NC, ${addr} [no jump]`);
                this.PC += 2;
                return 12;
            }
        } else if (currByte === 0x10) {
            // Halt CPU & LCD display until button pressed.
            // STOP 0

            console.log("STOP 0 (not implemented. no button press support yet");
            this.PC += 2;
            return 4;
        } else if (currByte === 0x18) {
            // Add n to current address and jump to it.
            // JR r8
            let offset = this.bus.readByte(this.PC + 1);
            if (offset === 0) {
                console.log("JR 0 would lead to an infinite loop. SKipping for now");
                this.PC += 2;
                return 8;
            }
            this.PC += 2; // move to next instruction then add offset
            const addr = this.PC + offset;
            this.PC = addr;
            console.log(`JR ${offset} [jumped to addr ${addr}]`);
            return 8;
        } else if (currByte === 0x7F) {
            // LD A,A
            console.log("LD A, A");
            this.A = this.A;
            this.PC++;
            return 4;
        } else if (currByte === 0x7C) {
            // LD A,H
            console.log("LD A, H");
            this.A = this.H();
            this.PC++;
            return 4;
        } else if (currByte === 0x78) {
            // LD A,B
            console.log("LD A, B");
            this.A = this.B;
            this.PC++;
            return 4;
        } else if (currByte === 0x79) {
            // LD A,C
            console.log("LD A, C");
            this.A = this.C;
            this.PC++;
            return 4;
        } else if (currByte === 0xFF) {
            // Push present address onto stack. Jump to address $0000 + 56 (0x38).
            // RST 38H
            console.log("RST 38H");
            this.stackPush(this.PC & 0x00FF);
            this.stackPush((this.PC & 0xFF00) >> 8);
            this.PC = 0x38;
            return 16;
        } else if (currByte === 0x3E) {
            // LD A, d8
            let value = this.bus.readByte(this.PC + 1);
            this.A = value;
            console.log(`[${this.PC}] LD A, ${value}`);
            this.PC += 2;
            return 8;
        } else if (currByte === 0xF3) {
            // disable interrupts
            // DI
            this.IME = 0x00;
            this.PC++;
            return 4;
        } else if (currByte === 0xE0) {
            // LDH (a8),A
            let value = this.bus.readByte(this.PC + 1);
            this.bus.writeByte(0xFF00 + value, this.A);
            console.log(`[${this.PC}] LDH (${0xFF00 + value}), A`);
            this.PC += 2;
            return 12;
        } else if (currByte === 0xF0) {
            /// LDH A, (a8)
            let value = this.bus.readByte(this.PC + 1);
            this.A = this.bus.readByte(0xFF00 + value);
            console.log(`[${this.PC}] LDH A, (${0xFF00 + value})`);
            this.PC += 2;
            return 12;
        } else if (currByte === 0xFE) {
            // Compare A with n. This is basically an A - n subtraction instruction but the results are thrown away.
            // CP d8
            let value = this.bus.readByte(this.PC + 1);
            console.log(`CP ${value}`);
            let result = wrappingByteSub(this.A, value);
            this.updateZeroFlag(result[0]);
            this.setFlag(SUBTRACTION_FLAG);
            this.updateHalfCarryFlag(this.A, value);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC += 2;
            return 8;
        }

        console.log(`Error: encountered an unsupported opcode of ${currByte} at address ${this.PC}`);
        return 0;
    }

      // @return number-of-cycles the last instruction took
    public executeNextStep() {
      return this.executeInstruction();
    }

    private stackPush(value: number) {
        this.bus.writeByte(this.SP, value);
        this.SP++;
    }

    private updateZeroFlag(value: number) {
        if (value === 0x00) {
            // set the zero flag
            this.setFlag(ZERO_FLAG);
        } else {
            this.clearFlag(ZERO_FLAG);
        }
    }

    private updateHalfCarryFlag(value1: number, value2: number) {
        if ((value1 & 0xF) + (value2 & 0xF) > 0xF) {
            this.setFlag(HALF_CARRY_FLAG);
        } else {
            this.clearFlag(HALF_CARRY_FLAG);
        }
    }
}

const ROM_BANK_0_START_ADDR = 0x0000;
const ROM_BANK_0_END_ADDR = 0x3FFF;

class Gameboy {
  public cartridge: Cartridge;
  public memory: Memory;
  public bus: MemoryBus;
  public cpu: CPU;
  public ppu: PPU;

  // counter of cycles that has passed since CPU was powered on
  public cyclesCounter: number;

  constructor() {
    this.memory = new Memory();
    this.ppu = new PPU();
    this.bus = new MemoryBus(this.memory, this.ppu);
    this.cpu = new CPU(this.bus);
  }

  public powerOn() {
      if (!this.cartridge.isLoaded) {
          console.error("Error powering on the GameBoy due to the cartridge not being loaded yet.")
          return;
      }

      if (this.cartridge.getRomHeaderInfo().cartridgeType !== 0x00) {
          console.log(`Error: MBC banking is not yet supported and the rom does require MBC banking`);
          return;
      }

      // initialize the CPU
      this.cpu.initAfterRomLoaded();
  }

  public getScreenBuffer() {
    return this.ppu.getScreenBufferData();
  }

  public executeNextStep() {
      const cycles = this.cpu.executeNextStep();
      this.ppu.step(cycles);
  }

  public executeRom() {
    this.cyclesCounter = 0;
    while (true) {
      // ExecuteNextInstruction will modify the PC register appropriately
      this.cyclesCounter += this.cpu.executeNextStep();
    }
  }

  // when cart is loaded its code is memory mapped to
  // addr 0000-7FFFh of the gameboy's internal ram.
  // addresses 0000-3FFF is ROM Bank 00 (read-only)
  // which contains the Interrupt Table, and Header Information
  public async loadCartridge(cart: Cartridge) {
      this.cartridge = cart;
      await this.cartridge.load();

      // load bank 0 into Gameboy's ram (0x0000 - 0x3FFF)(16K bytes)
      this.loadRomDataIntoMemory(0x0000, 0x0000, ROM_BANK_END_ADDR);
  }

  private loadRomDataIntoMemory(startRamAddr: number, startRomAddr: number, bankSizeBytes: number) {
      const endRamAddr = startRamAddr + bankSizeBytes;
      for (let memAddr = startRamAddr, romAddr = startRomAddr; memAddr <= endRamAddr; memAddr++, romAddr++) {
        this.memory.ram[memAddr] = this.cartridge.romBytes[romAddr];
      }
  }
}

interface IRomHeader {
    romTitle: string;
    //manufacturerCode: string;
    licenseCode: number;
    SGBSupported: boolean; // addr 0x0146. if value == 0x00 then not supported, if value == 0x03 then supported
                           // The SGB disables its SGB functions if this byte is set to another value than 03h.
    cartridgeType: number;
    romSize: number;
    ramSize: number;
    destinationCode: number;
    maskROMVersionNumber: number;
    headerChecksum: number;
    //globalChecksum: number; // not verified by Gameboy
}

const HEADER_TITLE_START_ADDR = 0x0134;
const HEADER_TITLE_END_ADDR = 0x0143;

class Cartridge {
    public romBytes: Uint8Array;
    public romName: string;
    public isLoaded: boolean;

    constructor(name: string) {
        this.romName = name;
        this.isLoaded = true;
    }

    public async load() {
        this.romBytes = await loadRom('tetris');
        this.isLoaded = true;
    }

    public getRomHeaderInfo(): IRomHeader {
        const titleBytes = this.romBytes.slice(HEADER_TITLE_START_ADDR, HEADER_TITLE_END_ADDR + 1);

        return {
            romTitle: uInt8ArrayToUtf8(titleBytes),
            SGBSupported: this.romBytes[0x0146] === 0x03 ? true : false,
            licenseCode: this.getLiscenseCode(),
            cartridgeType: this.romBytes[0x0147],
            romSize: this.romBytes[0x0148],
            ramSize: this.romBytes[0x0149],
            destinationCode: this.romBytes[0x014A],
            maskROMVersionNumber: this.romBytes[0x014C],
            headerChecksum: this.romBytes[0x014D]
        };
    }

    private getLiscenseCode(): number {
        const oldLiscenseCode = this.romBytes[0x014B];
        if (oldLiscenseCode === 0x33) {
            // value of 0x33 signifies that the liscense code is found in the newLiscenseCode byte
            return (this.romBytes[0x0144] << 8) & this.romBytes[0x0145];
        }

        return oldLiscenseCode;
    }
}