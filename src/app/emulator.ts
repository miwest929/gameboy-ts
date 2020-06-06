import { loadRomFromFileSystem } from './rom_loader';
import { uInt8ArrayToUtf8, displayAsHex } from './utils';
import { PPU, Address } from './ppu';
import { MemoryBankController, MBC0, MBC1 } from './mbc';
import { DebugConsole } from './debugger_console';

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

const IE_ADDR = 0xFFFF;
class InterruptEnabledRegister {
    public RawValue: number;

    constructor() {
        this.RawValue = 0x00;
    }

    public Enable(interruptBit: Interrupt) {
        this.RawValue |= interruptBit;
    }

    public VBlankEnabled(): boolean {
        return (this.RawValue & 0x01) === 0x01;
    }
  
    public LCDStatEnabled(): boolean {
          return (this.RawValue & 0x02) === 0x02;
    }
  
    public TimerEnabled(): boolean {
          return (this.RawValue & 0x04) === 0x04;
    }
  
    public SerialEnabled(): boolean {
          return (this.RawValue & 0x08) === 0x08;
    }
  
    public JoypadEnabled(): boolean {
          return (this.RawValue & 0x10) === 0x10;
    }
}

export enum Interrupt {
  VBLANK = 0x01,
  LCDCSTAT = 0x02,
  TIMER = 0x04,
  SERIAL = 0x08,
  JOYPAD = 0x10,
  UNUSED1 = 0x20,
  UNUSED2 = 0x40,
  UNUSED3 = 0x80
};

enum InterruptAddress {
    VBLANK = 0x0040,
    LCDCSTAT = 0x0048,
    TIMER = 0x0050,
    SERIAL = 0x0058,
    JOYPAD = 0x0060
}

const IF_ADDR = 0xFF0F;
class InterruptRequestRegister {
    public RawValue: number;

    constructor() {
        this.RawValue = 0x00;
    }

    public ClearRequest(interruptBit: Interrupt) {
      this.RawValue &= bitNegation(interruptBit);
    }

    public Request(interruptBit: Interrupt) {
        this.RawValue |= interruptBit;
    }

    public VBlankRequested(): boolean {
      return (this.RawValue & 0x01) === 0x01;
    }

    public LCDStatRequested(): boolean {
        return (this.RawValue & 0x02) === 0x02;
    }

    public TimerRequested(): boolean {
        return (this.RawValue & 0x04) === 0x04;
    }

    public SerialRequested(): boolean {
        return (this.RawValue & 0x08) === 0x08;
    }

    public JoypadRequested(): boolean {
        return (this.RawValue & 0x10) === 0x10;
    }
}

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

export class MemoryBus {
    private memory: Memory;
    private ppu: PPU;
    private cpu: CPU;
    public cartridge: Cartridge;

    constructor(memory: Memory, ppu: PPU, cpu: CPU) {
        this.memory = memory;
        this.ppu = ppu;
        this.cpu = cpu;
        this.cartridge = null;
    }

    public writeByte(addr: number, value: number) {
        // TODO: Implement Echo Ram 0xE000 - 0xFDFF. It's a mirror of WRAM addr 0xC000 - 0xDDFF
        //       Typically not used. Writing to an echo address causes a write to that AND write to associated address in WRAM.
        //       And vice versa.
        if (addr >= Address.VRAM_ADDR_BEGIN && addr <= Address.VRAM_ADDR_END) {
            // if writing to memory mapped vram
            this.ppu.writeToVRAM(addr - Address.VRAM_ADDR_BEGIN, value);
        } else if (addr >= Address.OAM_ADDR_BEGIN && addr <= Address.OAM_ADDR_END) {
            this.ppu.writeToOAM(addr - Address.OAM_ADDR_BEGIN, value);
        } else if (addr === IF_ADDR) {
            // interrupt request register
            //if (value === 0xE1) {
            //    this.cpu.
            //}
            this.cpu.IF.RawValue = value;
        } else if (addr === IE_ADDR) {
            this.cpu.IE.RawValue = value;
        } else if (addr === 0xff46) { // DMA Transfer and Start Address
            // Initiate DMA Transfer.
            // Source address range is 0xXX00 - 0xXX9F (where XX is the written byte value)
            // Dest. address range is 0xFE00 - 0xFE9F
            this.performDMAOAMTransfer(value);
        } else if (addr >= 0xff40 && addr <= 0xff4a) { //PPU Special Registers
            this.ppu.writeSpecialRegister(addr, value);
        } else if (addr === 0xFF01) {
            console.log(`OUT: ${String.fromCharCode(value)}`);
        } else if (addr >= 0xff00 && addr <= 0xff30) { // I/O Special Registers
            console.warn("I/O Registers aren't supported yet");
        } else if (addr >= 0x0000 && addr <= 0x7FFF) {  
            this.cartridge.mbc.WriteByte(addr, value);
        } else if (addr < 0xFEA0 || addr > 0xFEFF) { // addr between FEA0 and FEFF are unused. Writing to them should be ignored
            this.memory.write(addr, value);
        } else {
            console.log(`Writing to addr ${displayAsHex(addr)} isn't supported`);
        }
    }

    public readByte(addr: number): number {
        if (addr >= Address.VRAM_ADDR_BEGIN && addr <= Address.VRAM_ADDR_END) {

            return this.memory.read(addr); // this.ppu.readFromVRAM(addr - Address.VRAM_ADDR_BEGIN);
        } else if (addr >= Address.OAM_ADDR_BEGIN && addr <= Address.OAM_ADDR_END) {
            return this.ppu.readFromOAM(addr - Address.OAM_ADDR_BEGIN);
        } else if (addr >= 0xff40 && addr <= 0xff4a) {
            return this.ppu.readFromSpecialRegister(addr);
        } else if (addr === IF_ADDR) {
            // interrupt request register
            return this.cpu.IF.RawValue;
        } else if (addr === IE_ADDR) {
            // interrupt request register
            return this.cpu.IE.RawValue;
        } else if (addr >= 0xFEA0 && addr <= 0xFEFF) { // reading from unused memory should return 0x00
            return 0x00;
        } else if (addr >= 0x0000 && addr <= 0x7FFF) {
            return this.cartridge.mbc.ReadByte(addr);
        } else {
            return this.memory.read(addr);
        }
    }

    public RequestInterrupt(interrupt: Interrupt) {
        this.cpu.RequestInterrupt(interrupt);
    }

    private performDMAOAMTransfer(baseSrcAddr: number) {
        const srcAddrStart: number = (baseSrcAddr << 8) | 0x00;
        //console.log(`Performing DMA OAM Transfer from addr ${srcAddrStart} - ${srcAddrStart + 0x9F} to oam addr ${0xFE00} - ${0xFE9F}`);
        for (let offsetAddr = 0x00; offsetAddr <= 0x9F; offsetAddr++) {
            const value = this.memory.read(srcAddrStart + offsetAddr);
            this.ppu.writeToOAM(0xFE00 + offsetAddr, value);
        }
    }
}

export const ZERO_FLAG: number = 0x80; // 0x7F; // set when the instruction results in a value of 0. Otherwise (result different to 0) it is cleared.
export const SUBTRACTION_FLAG: number = 0x40; // 0xBF; // set when the instruction is a subtraction.  Otherwise (the instruction is an addition) it is cleared.
export const HALF_CARRY_FLAG: number = 0x20; // 0xDF; // set when a carry from bit 3 is produced in arithmetical instructions.  Otherwise it is cleared.
export const CARRY_FLAG: number = 0x10; // 0xEF; // set when a carry from bit 7 is produced in arithmetical instructions.  Otherwise it is cleared.

// The second boolean return value determines if a carry has occurred.
// This applies to all wrapping arthmetic functions
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

// This emulator doesn't run the bootstrap rom. But it
// needs to initialize the registers to their values as 
// if the bootstrap has run
const INITIAL_A_REG_VALUE = 0x01;
const INITIAL_F_REG_VALUE = 0x80;
const INITIAL_B_REG_VALUE = 0x00;
const INITIAL_C_REG_VALUE = 0x13;
const INITIAL_D_REG_VALUE = 0x00;
const INITIAL_E_REG_VALUE = 0xD8;
const INITIAL_HL_REG_VALUE = 0x014D;

// used for delaying disabling interrupts
const DISABLE_COUNTER_INACTIVE = -1;

type FlagRegister = {
    subtractionFlag: boolean,
    carryFlag: boolean,
    zeroFlag: boolean,
    halfCarryFlag: boolean,
}

export class CPU {
	// registers (unless specified all registers are assumed to be 1 byte)
	A: number;
	B: number;
	C: number;
	D: number;
    E: number; 
    
    F: number; // flags register
    Flags: FlagRegister;

	//H: number;
    //L: number;
    HL: number; // 2 bytes
	SP: number; // 2 bytes. register points to the current stack position
    PC: number; // 2 bytes

    IME: number; //=0
    IF: InterruptRequestRegister; // address 0xff0f
    IE: InterruptEnabledRegister; // address 0xffff

	// Reference to RAM
    bus: MemoryBus;
    
    // instruction counter for disabling instructions
    disableInterruptsCounter: number;

    // [used by DebuggerConsole] Opcode of the last executed instruction
    public lastExecutedOpCode: number;

    constructor() {
        this.A = INITIAL_A_REG_VALUE;
        this.B = INITIAL_B_REG_VALUE;
        this.C = INITIAL_C_REG_VALUE;
        this.D = INITIAL_D_REG_VALUE;
        this.E = INITIAL_E_REG_VALUE;
        this.HL = INITIAL_HL_REG_VALUE;

        // NOTE: According to BGB Debugger. This register is initialized to 0xB0 (eg: zero, hc, and carry flags on)
        this.F = INITIAL_F_REG_VALUE; // 0x80 = 0x1000xxxx
        this.Flags = {
            zeroFlag: true,
            subtractionFlag: false,
            halfCarryFlag: false,
            carryFlag: false
        }

        this.disableInterruptsCounter = DISABLE_COUNTER_INACTIVE; // -1 means to ignore this counter
    }

    public setMemoryBus(bus: MemoryBus) {
        this.bus = bus;
    }

    public RequestInterrupt(interruptBit: number) {
        this.IF.Request(interruptBit);
        this.IE.Enable(interruptBit);
    }

    public initAfterRomLoaded() {
        this.PC = 0x100;  // starting address in the rom. The instruction at this address should be a JMP that jumps to the first
                          // actual instruction to be executed.
        this.SP = 0xFFFE;

        // initialize Interrupt related flag registers
        this.IME = 0x00;
        this.IF = new InterruptRequestRegister();
        this.IE = new InterruptEnabledRegister();
    }

    public H(): number {
        return (this.HL & 0xFF00) >> 8;
    }

    // decrement the H portion of HL register by 1
    public decrementH() {
      const result = wrappingByteSub(this.H(), 1);
      this.HL = (result[0] << 8) | this.L();
    }

    // decrement the H portion of HL register by 1
    public decrementL() {
        const result = wrappingByteSub(this.L(), 1);
        this.HL = (this.H() << 8) | result[0];
    }
  

    public L(): number {
        return this.HL & 0x00FF;
    }

    public DE(): number {
        return (this.D << 8) | this.E;
    }

    public BC(): number {
        return (this.B << 8) | this.C;
    }

    public decrementBC() {
        const result = wrappingTwoByteSub(((this.B << 8) | this.C), 1);
        this.B = result[0] >> 8;
        this.C = result[0] & 0x00FF;
    }

    public getFlag(flag: number): boolean {
        if (flag === SUBTRACTION_FLAG) {
            return this.Flags.subtractionFlag;
        } else if (flag === ZERO_FLAG) {
            return this.Flags.zeroFlag;
        } else if (flag === HALF_CARRY_FLAG) {
            return this.Flags.halfCarryFlag;
        } else if (flag === CARRY_FLAG) {
            return this.Flags.carryFlag;
        }
    }

    public clearFlag(flag: number) {
        if (flag === SUBTRACTION_FLAG) {
            this.Flags.subtractionFlag = false;
        } else if (flag === ZERO_FLAG) {
            this.Flags.zeroFlag = false;
        } else if (flag === HALF_CARRY_FLAG) {
            this.Flags.halfCarryFlag = false;
        } else if (flag === CARRY_FLAG) {
            this.Flags.carryFlag = false;
        }
        // this.F = this.F & flag;
    }

    public setFlag(flag: number) {
        if (flag === SUBTRACTION_FLAG) {
            this.Flags.subtractionFlag = true;
        } else if (flag === ZERO_FLAG) {
            this.Flags.zeroFlag = true;
        } else if (flag === HALF_CARRY_FLAG) {
            this.Flags.halfCarryFlag = true;
        } else if (flag === CARRY_FLAG) {
            this.Flags.carryFlag = true;
        }
        //console.log(`[set ${displayAsHex(flag)} flag] Before flags = ${displayAsHex(this.F)}`);
        //this.F = this.F | ~flag;
        //console.log(`[set ${displayAsHex(flag)} flag] After flags = ${displayAsHex(this.F)}`);
        //console.log(`[set ${displayAsHex(flag)} flag] is flag actually set? ${this.getFlag(flag) === true}`)
    }

    public shouldDisableInterrupts() {
        if (this.disableInterruptsCounter === DISABLE_COUNTER_INACTIVE) {
            return false;
        }

       if (this.disableInterruptsCounter === 0) {
             return true;
        }

        this.disableInterruptsCounter--;
        return false;
    }

    public disableInterrupts() {
        this.IME = 0x00;
        this.disableInterruptsCounter = DISABLE_COUNTER_INACTIVE; // prevent interrupts from being disabled again
    }

    public startDisableInterrupt() {
        this.disableInterruptsCounter = 1;
    }

    // @return boolean -> true if interrupt was invoked, false otherwise;
    public processInterrupts(): boolean {
        if (this.IME === 0x00) {
            return false;
        }

        /*
          VBlank Interrupt has highest priority
          Joypad interrupts has lowest
        */
        let wasInterruptInvoked = false;
        const returnAddr = this.PC;
        if (this.IE.VBlankEnabled() && this.IF.VBlankRequested()) {
           // jump to vblank int address
           this.IF.ClearRequest(Interrupt.VBLANK);

           this.PC = InterruptAddress.VBLANK;
           wasInterruptInvoked = true;
        } else if (this.IE.LCDStatEnabled() && this.IF.LCDStatRequested()) {
            this.IF.ClearRequest(Interrupt.LCDCSTAT);
            this.PC = InterruptAddress.LCDCSTAT;
            wasInterruptInvoked = true;
        } else if (this.IE.TimerEnabled() && this.IF.TimerRequested()) {
            this.IF.ClearRequest(Interrupt.TIMER);
            this.PC = InterruptAddress.TIMER;
            wasInterruptInvoked = true;
        } else if (this.IE.SerialEnabled() && this.IF.SerialRequested()) {
            this.IF.ClearRequest(Interrupt.SERIAL);
            this.PC = InterruptAddress.SERIAL;
            wasInterruptInvoked = true;
        } else if (this.IE.JoypadEnabled() && this.IF.JoypadRequested()) {
            this.IF.ClearRequest(Interrupt.JOYPAD);
            this.PC = InterruptAddress.JOYPAD;
            wasInterruptInvoked = true;
        }

        if (wasInterruptInvoked) {
            // disable future interrupts until they're enabled again
            /*
                1. Two wait states are executed (2 machine cycles pass while nothing occurs, presumably the CPU is executing NOPs during this time).
                2. The current PC is pushed onto the stack, this process consumes 2 more machine cycles.
                3. The high byte of the PC is set to 0, the low byte is set to the address of the handler ($40,$48,$50,$58,$60). This consumes one last machine cycle.
            */
            this.IME = 0x00;
            console.log(`****************** INVOKED INTERRUPT. PC = ${this.PC} *********************`);
            const [higherByte, lowerByte] = this.split16BitValueIntoTwoBytes(returnAddr);
            this.stackPush(higherByte);
            this.stackPush(lowerByte);
        }

        return wasInterruptInvoked;
    }
    
    // READ-ONLY. Just reads the next instruction and disassemblies it as a string
    // This does not execute the instruction. Just returns it as string.
    // TODO: Setting the lastExecutedOpCode value is a side effect. Only used by the debugger so we can
    //       break on specific opcode. High coupling.
    // TODO: Now that we separated printing from executing instruction. We have shotgun surgory situation.
    //       Adding a new instruction requires modifying this method and the 'executeNextInstruction' method.
    //       The way around this is for each instruction to be its own class that includes execution AND disassembly.
    //       Since that would be a gigantic refactoring, hold off doing it until the emulator is working
    public disassembleNextInstruction(): string {
        const currByte = this.bus.readByte(this.PC);
        
    	if (currByte === 0x31) {
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;

            this.lastExecutedOpCode = 0x31;
            return `LD SP, ${displayAsHex(addr)}`;
        } else if (currByte === 0x00) {
            this.lastExecutedOpCode = 0x00;
            return "NOP";
        } else if (currByte === 0xC3) {
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            this.lastExecutedOpCode = 0xC3;
            return `JP ${displayAsHex(addr)}`;
        } else if (currByte === 0xAF) {
            this.lastExecutedOpCode = 0xAF;
            return "XOR A";
        } else if (currByte === 0x21) {
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const value = (msb << 8) | lsb;
            this.lastExecutedOpCode = 0x21;
            return `LD HL, ${displayAsHex(value)}`;
        } else if (currByte === 0x0E) {
            const value = this.bus.readByte(this.PC + 1);
            this.lastExecutedOpCode = 0x0E;
            return `LD C, ${value}`;
        } else if (currByte === 0x06) {
            const value = this.bus.readByte(this.PC + 1);
            this.lastExecutedOpCode = 0x06;
            return `LD B, ${displayAsHex(value)}`;
        } else if (currByte === 0x32) {
            this.lastExecutedOpCode = 0x32;
            return "LD (HL-), A";
        } else if (currByte === 0x05) {
            this.lastExecutedOpCode = 0x05;
            return "DEC B";
        } else if (currByte === 0x20) {
            this.lastExecutedOpCode = 0x20;
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            if (!this.getFlag(ZERO_FLAG)) {
                return `JR NZ, ${offset} [jumped]`;
            } else {
                return `JR NZ, ${offset} [not jumped]`;
            }
        } else if (currByte === 0x0D) {
            this.lastExecutedOpCode = 0x0D;
            return `DEC C`;
        } else if (currByte === 0x1D) {
            this.lastExecutedOpCode = 0x1D;
            return `DEC E`;
        } else if (currByte === 0x16) {
            this.lastExecutedOpCode = 0x16;
            const value = this.bus.readByte(this.PC + 1);
            return `LD D, ${displayAsHex(value)}`;
        } else if (currByte === 0x1F) {
            this.lastExecutedOpCode = 0x1F;
            return "RRA";
        } else if (currByte === 0x25) {
            this.lastExecutedOpCode = 0x25;
            return "DEC H";
        } else if (currByte === 0x15) {
            this.lastExecutedOpCode = 0x15;
            return "DEC D";
        } else if (currByte === 0xB0) {
            this.lastExecutedOpCode = 0xB0;
            return "OR B";
        } else if (currByte === 0x14) {
            this.lastExecutedOpCode = 0x14;
            return "INC D";
        } else if (currByte === 0x7B) {
            this.lastExecutedOpCode = 0x7B;
            return "LD A, E";
        } else if (currByte === 0xBF) {
            this.lastExecutedOpCode = 0xBF;
            return "CP A";
        } else if (currByte === 0x29) {
            this.lastExecutedOpCode = 0x29;
            return "ADD HL, HL";
        } else if (currByte === 0x19) {
            this.lastExecutedOpCode = 0x19;
            return "ADD HL, DE";
        } else if (currByte === 0x77) {
            this.lastExecutedOpCode = 0x77;
            return "LD (HL), A";
        } else if (currByte === 0x07) {
            this.lastExecutedOpCode = 0x07;
            return "RLCA [NOT IMPL]";
        } else if (currByte === 0x08) {
            this.lastExecutedOpCode = 0x08;
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `LD (${displayAsHex(addr)}), SP`;
        } else if (currByte === 0x12) {
            this.lastExecutedOpCode = 0x12;
            return "LD (DE), A";
        } else if (currByte === 0x0C) {
            this.lastExecutedOpCode = 0x0C;
            return "INC C";
        } else if (currByte === 0xD2) {
            this.lastExecutedOpCode = 0xD2;
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `JP NC, ${displayAsHex(addr)}`;
        } else if (currByte === 0x10) {
            this.lastExecutedOpCode = 0x10;
            console.log("STOP 0 (not implemented. no button press support yet");
        } else if (currByte === 0x18) {
            this.lastExecutedOpCode = 0x18;
            let offset = this.bus.readByte(this.PC + 1);
            return `JR ${offset}`;
        } else if (currByte === 0x7F) {
            this.lastExecutedOpCode = 0x7F;
            return "LD A, A";
        } else if (currByte === 0x7C) {
            this.lastExecutedOpCode = 0x7C;
            return "LD A, H";
        } else if (currByte === 0x78) {
            this.lastExecutedOpCode = 0x78;
            return "LD A, B";
        } else if (currByte === 0x79) {
            this.lastExecutedOpCode = 0x79;
            return "LD A, C";
        } else if (currByte === 0xFF) {
            this.lastExecutedOpCode = 0xFF;
            return "RST 38H";
        } else if (currByte === 0x3E) {
            this.lastExecutedOpCode = 0x3E;
            let value = this.bus.readByte(this.PC + 1);
            return `LD A, ${displayAsHex(value)}`;
        } else if (currByte === 0xF3) {
            this.lastExecutedOpCode = 0xF3;
            return "DI";
        } else if (currByte === 0xE0) {
            this.lastExecutedOpCode = 0xE0;
            let value = this.bus.readByte(this.PC + 1);
            return `LDH (${0xFF00 + value}), A`;
        } else if (currByte === 0xF0) {
            this.lastExecutedOpCode = 0xF0;
            let value = this.bus.readByte(this.PC + 1);
            return `LDH A, (${0xFF00 + value})`;
        } else if (currByte === 0xFE) {
            this.lastExecutedOpCode = 0xFE;
            let value = this.bus.readByte(this.PC + 1);
            return `CP ${value}`;
        } else if (currByte === 0x36) {
            this.lastExecutedOpCode = 0x36;
            const value = this.bus.readByte(this.PC + 1);
            return `LD (HL), ${value}`;
        } else if (currByte === 0xEA) {
            this.lastExecutedOpCode = 0xEA;
            const addr = this.readTwoByteValue(this.PC + 1)
            return `LDH (${addr}), A`;
        } else if (currByte === 0x2A) {
            this.lastExecutedOpCode = 0x2A;
            return "LD A, (HL+)";
        } else if (currByte === 0xE2) {
            this.lastExecutedOpCode = 0xE2;
            return `LD (C), A`;
        } else if (currByte === 0xF2) {
            this.lastExecutedOpCode = 0xF2;
            return `LD A, (C)`;
        } else if (currByte === 0xCD) {
            this.lastExecutedOpCode = 0xCD;
            const addr = this.readTwoByteValue(this.PC + 1);
            return `CALL ${displayAsHex(addr)}`;
        } else if (currByte === 0x01) {
            this.lastExecutedOpCode = 0x01;
            const value = this.readTwoByteValue(this.PC + 1);
            return `LD BC, ${displayAsHex(value)}`;
        } else if (currByte === 0xD9) {
            this.lastExecutedOpCode = 0xD9;
            return 'RETI';
        } else if (currByte === 0xC9) {
            this.lastExecutedOpCode = 0xC9;
            return `RET <two-byte-stack-pop>`;
        } else if (currByte === 0xFB) {
            this.lastExecutedOpCode = 0xFB;
            return 'EI';
        } else if (currByte === 0x0B) {
            this.lastExecutedOpCode = 0x0B;
            return 'DEC BC';
        } else if (currByte === 0xB1) {
            this.lastExecutedOpCode = 0xB1;
            return 'OR C';
        } else if (currByte === 0xF5) {
            this.lastExecutedOpCode = 0xF5;
            return 'PUSH AF'
        } else if (currByte === 0xC5) {
            this.lastExecutedOpCode = 0xC5;
            return 'PUSH BC'
        } else if (currByte === 0xD5) {
            this.lastExecutedOpCode = 0xD5;
            return 'PUSH DE'
        } else if (currByte === 0xE5) {
            this.lastExecutedOpCode = 0xE5;
            return 'PUSH HL'
        } else if (currByte === 0xA7) {
            this.lastExecutedOpCode = 0xA7;
            return 'AND A';
        } else if (currByte === 0xA0) {
            this.lastExecutedOpCode = 0xA0;
            return 'AND B';
        } else if (currByte === 0xA1) {
            this.lastExecutedOpCode = 0xA1;
            return 'AND C';
        } else if (currByte === 0xA2) {
            this.lastExecutedOpCode = 0xA2;
            return 'AND D';
        } else if (currByte === 0xA3) {
            this.lastExecutedOpCode = 0xA3;
            return 'AND E';
        } else if (currByte === 0xA4) {
            this.lastExecutedOpCode = 0xA4;
            return 'AND H';
        } else if (currByte === 0xA5) {
            this.lastExecutedOpCode = 0xA5;
            return 'AND L';
        } else if (currByte === 0x28) {
            this.lastExecutedOpCode = 0x28;
            return 'JR Z, r8';
        } else if (currByte === 0xC0) {
            this.lastExecutedOpCode = 0xC0;
            return 'RET NZ'
        } else if (currByte === 0xC8) {
            this.lastExecutedOpCode = 0xC8;
            return 'RET Z'
        } else if (currByte === 0xD0) {
            this.lastExecutedOpCode = 0xD0;
            return 'RET NC'
        } else if (currByte === 0xD8) {
            this.lastExecutedOpCode = 0xD8;
            return 'RET C'
        } else if (currByte === 0xFA) {
            this.lastExecutedOpCode = 0xFA;
            return 'LD A, (a16)';
        } else if (currByte == 0x3D) {
            this.lastExecutedOpCode = 0x3D;
            return 'DEC A';
        } else if (currByte == 0x2D) {
            this.lastExecutedOpCode = 0x2D;
            return 'DEC L';
        } else if (currByte == 0x11) {
            this.lastExecutedOpCode = 0x11;
            const value = this.readTwoByteValue(this.PC + 1)
            return `LD DE, ${value}`;
        } else if (currByte === 0x7E) {
            this.lastExecutedOpCode = 0x7E;
            return 'LD A, (HL)';
        } else if (currByte === 0x6E) {
            this.lastExecutedOpCode = 0x6E;
            return 'LD L, (HL)';
        } else if (currByte === 0x5E) {
            this.lastExecutedOpCode = 0x6E;
            return 'LD E, (HL)';
        } else if (currByte === 0x4E) {
            this.lastExecutedOpCode = 0x4E;
            return 'LD C, (HL)';
        } else if (currByte === 0xB7) {
            this.lastExecutedOpCode = 0xB7;
            return 'OR A';
        } else if (currByte === 0xC1) {
            this.lastExecutedOpCode = 0xC1;
            return 'POP BC';
        } else if (currByte === 0xD1) {
            this.lastExecutedOpCode = 0xD1;
            return 'POP DE';
        } else if (currByte === 0xE1) {
            this.lastExecutedOpCode = 0xE1;
            return 'POP HL';
        } else if (currByte === 0xF1) {
            this.lastExecutedOpCode = 0xF1;
            return 'POP AF';
        } else if (currByte === 0x3C) {
            this.lastExecutedOpCode = 0x3C;
            return 'INC A';
        } else if (currByte === 0x2C) {
            this.lastExecutedOpCode = 0x2C;
            return 'INC L';
        } else if (currByte === 0x1C) {
            this.lastExecutedOpCode = 0xC1;
            return 'INC E';
        } else if (currByte === 0x34) {
            return 'INC (HL)';
        }
    }

    private readTwoByteValue(baseAddr: number) {
        const lsb = this.bus.readByte(baseAddr);
        const msb = this.bus.readByte(baseAddr + 1);
        return (msb << 8) | lsb;        
    }

    // Due to JMP, RET instructions this fn must modify the PC register itself.
    // The return value is the number of cycles the instruction took
    // Instruction cycle counts can be found here: http://www.pastraiser.com/cpu/gameboy/gameboy_opcodes.html
    // @return cyclesConsumed: number = The number of cycles the just executed instruction took
    public executeInstruction(): number {
        if (this.shouldDisableInterrupts()) {
            this.disableInterrupts();
        }

        const currByte = this.bus.readByte(this.PC);
    	if (currByte === 0x31) {
            // LD SP, N
            // 3 byte instruction
            this.SP = this.readTwoByteValue(this.PC + 1);
            this.PC += 3;

            return 12;
        } else if (currByte === 0x00) {
          // NOP
          this.PC++;
          return 4;
        } else if (currByte === 0xC3) {
            // JP 2-byte-address
            this.PC = this.readTwoByteValue(this.PC + 1);;
            return 16;
        } else if (currByte === 0xAF) {
            // XOR A  (1 byte, 4 cycles)
            this.A = this.A ^ this.A;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        } else if (currByte === 0x21) {
            // LD HL, d16 (3 bytes, 12 cycles)
            this.HL = this.readTwoByteValue(this.PC + 1);
            this.PC += 3;
            return 12;
        } else if (currByte === 0x0E) {
            // LD C,d8
            this.C = this.bus.readByte(this.PC + 1);;            
            this.PC += 2;
            return 8;
        } else if (currByte === 0x06) {
            // LD B,d8
            this.B = this.bus.readByte(this.PC + 1);
            
            this.PC += 2;
            return 8;
        } else if (currByte === 0x32) {
            // Put A into memory address HL. Decrement HL.
            // LD (HL-),A
            this.bus.writeByte(this.HL, this.A);
            const result = wrappingTwoByteSub(this.HL, 1);
            this.HL = result[0];

            this.PC++;
            return 8;
        } else if (currByte === 0x05) {
            // DEC B
            const result = wrappingByteSub(this.B, 1);
            this.updateSubHalfCarryFlag(this.B, 1);
            this.B = result[0];
            this.setFlag(SUBTRACTION_FLAG);
        
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
                // jumped
                this.PC += offset;
                return 12;
            } else {
                // not jumped
                return 8;
            }
        } else if (currByte === 0x0D) {
            // DEC C
            const result = wrappingByteSub(this.C, 1);
            this.updateSubHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.C);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x1D) {
            // DEC E
            const result = wrappingByteSub(this.E, 1);
            this.updateSubHalfCarryFlag(this.E, 1);
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
            this.PC += 2;
            return 8;
        } else if (currByte === 0x1F) {
            // Rotate A right through Carry flag.
            // RRA
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
            this.decrementH();
            this.updateSubHalfCarryFlag(this.L(), 1);
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.L());
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x15) {
            // DEC D
            const result = wrappingByteSub(this.D, 1);
            this.updateSubHalfCarryFlag(this.D, 1);
            this.D = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.D);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0xB0) {
            // Logical OR register B with register A, result in A.
            // OR B
            this.A = this.A | this.B
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        } else if (currByte === 0x14) {
            // INC D
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
            this.A = this.E;
            this.PC++;
            return 4;
        } else if (currByte === 0xBF) {
            // compare A with A. Set flags as if they are equal
            // CP A
            this.setFlag(ZERO_FLAG);
            this.setFlag(SUBTRACTION_FLAG);
            this.clearFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x29) {
            // ADD HL,HL
            const result = wrappingTwoByteAdd(this.HL, this.HL);
            this.updateHalfCarryFlag(this.HL, this.HL);
            this.HL = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 8;
        } else if (currByte === 0x19) {
            // ADD HL,DE
            const result = wrappingTwoByteAdd(this.HL, this.DE());
            this.updateHalfCarryFlag(this.HL, this.DE());
            this.HL = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 8;
        } else if (currByte === 0x77) {
            // LD (HL),A
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

            this.PC += 3;
            return 20;
        } else if (currByte === 0x12) {
            // LD (DE), A
            this.bus.writeByte(this.DE(), this.A);

            this.PC++;
            return 8;
        } else if (currByte === 0x0C) {
            // INC C
            const result = wrappingTwoByteAdd(this.C, 1);
            this.updateHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.clearFlag(SUBTRACTION_FLAG);
            this.clearFlag(CARRY_FLAG);
            this.PC++;
            return 4;
        } else if (currByte === 0xD2) {
            // JP NC, a16
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            if (!this.getFlag(CARRY_FLAG)) {
                this.PC = addr;
                return 16;
            } else {
                this.PC += 2;
                return 12;
            }
        } else if (currByte === 0x10) {
            // Halt CPU & LCD display until button pressed.
            // STOP 0
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
            return 8;
        } else if (currByte === 0x7F) {
            // LD A,A
            this.A = this.A;
            this.PC++;
            return 4;
        } else if (currByte === 0x7C) {
            // LD A,H
            this.A = this.H();
            this.PC++;
            return 4;
        } else if (currByte === 0x78) {
            // LD A,B
            this.A = this.B;
            this.PC++;
            return 4;
        } else if (currByte === 0x79) {
            // LD A,C
            this.A = this.C;
            this.PC++;
            return 4;
        } else if (currByte === 0xFF) {
            // Push present address onto stack. Jump to address $0000 + 56 (0x38).
            // RST 38H
            this.PC++; // push the next address onto the stack
            //this.stackPush(this.PC & 0x00FF);
            //this.stackPush((this.PC >> 8);
            this.PC = 0x38;
            return 16;
        } else if (currByte === 0x3E) {
            // LD A, d8
            let value = this.bus.readByte(this.PC + 1);
            this.A = value;
            this.PC += 2;
            return 8;
        } else if (currByte === 0xF3) {
            /*
                disables interrupts but not
                immediately. Interrupts are disabled after
                instruction after DI is executed. 
            */
            // DI
            this.startDisableInterrupt();
            this.PC++;
            return 4;
        } else if (currByte === 0xE0) {
            // LDH (a8),A
            let value = this.bus.readByte(this.PC + 1);
            this.bus.writeByte(0xFF00 + value, this.A);
            this.PC += 2;
            return 12;
        } else if (currByte === 0xF0) {
            /// LDH A, (a8)
            let value = this.bus.readByte(this.PC + 1);
            this.A = this.bus.readByte(0xFF00 + value);
            this.PC += 2;
            return 12;
        } else if (currByte === 0xFE) {
            // Compare A with n. This is basically an A - n subtraction instruction but the results are thrown away.
            // CP d8
            let value = this.bus.readByte(this.PC + 1);
            let result = wrappingByteSub(this.A, value);
            this.updateZeroFlag(result[0]);
            this.setFlag(SUBTRACTION_FLAG);
            this.updateSubHalfCarryFlag(this.A, value);
            result[1] ? this.setFlag(CARRY_FLAG) : this.clearFlag(CARRY_FLAG);

            this.PC += 2;
            return 8;
        } else if (currByte === 0x36) {
            // LD (HL), d8
            const value = this.bus.readByte(this.PC + 1);
            this.bus.writeByte(this.HL, value);
            this.PC += 2;
            return 12;
        } else if (currByte === 0xEA) {
            // LDH (a16), A
            const addr = this.readTwoByteValue(this.PC + 1);
            this.bus.writeByte(addr, this.A);
            this.PC += 3;
            return 16;
        } else if (currByte === 0x2A) {
            // LD A, (HL+)     [1 byte, 8 cycles]
            this.A = this.bus.readByte(this.HL);
            this.HL++;
            this.PC++;
            return 8;
        } else if (currByte === 0xE2) {
            // LD (C), A
            this.bus.writeByte(0xFF00 + this.C, this.A);
            this.PC++;
            return 8;
        } else if (currByte === 0xF2) {
            // LD A, (C)
            this.A = this.bus.readByte(0xFF00 + this.C);
            this.PC++;
            return 8;
        } else if (currByte === 0xCD) {
            // CALL a16
            const addr = this.readTwoByteValue(this.PC + 1);

            // push address after this instruction on to the stack
            const returnAddr = this.PC + 3; // 3 because this instruction is 3 bytes long
            const [higherByte, lowerByte] = this.split16BitValueIntoTwoBytes(returnAddr);

            this.stackPush(higherByte);
            this.stackPush(lowerByte);  
            this.PC = addr;                      
        
            return 24;
        } else if (currByte === 0x01) {
            // LD BC, d16
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            this.B = msb;
            this.C = lsb;

            this.PC += 3;
            return 12;
        } else if (currByte === 0xD9) {
            // RETI
            // pop two bytes from the stack and jump to that address
            // then globally enable interrupts
            // TODO: Verify that popping two bytes from stack works like this. Use other emulators as implementation reference
            const lsb = this.stackPop();
            const msb = this.stackPop();
            const addr = (msb << 8) | lsb;

            this.IME = 0x01; // globally enable interrupts
            this.PC = addr;
            return 16;
        } else if (currByte === 0xC9) {
            // RET
            // Pop two bytes from stack & jump to that address.
            // TODO: Verify that popping two bytes from stack works like this. Use other emulators as implementation reference
            const lsb = this.stackPop();
            const msb = this.stackPop();
            const addr = (msb << 8) | lsb;
            this.PC = addr;

            return 16;
        } else if (currByte === 0xFB) {
            // EI
            this.IME = 0x01;
            this.PC++;

            return 4;
        } else if (currByte === 0x0B) {
            // DEC BC
            this.decrementBC();
            this.PC++;
            return 8;
        } else if (currByte === 0xB1) {
            // OR C
            this.A = this.A | this.C;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        } else if (currByte === 0xF5) {
            // PUSH AF
            this.stackPush(this.A);
            this.stackPush(this.F);
            this.PC++;
            return 16;
        } else if (currByte === 0xC5) {
            // PUSH BC
            this.stackPush(this.B);
            this.stackPush(this.C);
            this.PC++;
            return 16;
        } else if (currByte === 0xD5) {
            // PUSH DE
            this.stackPush(this.D);
            this.stackPush(this.E);
            this.PC++;
            return 16;
        } else if (currByte === 0xE5) {
            // PUSH HL
            this.stackPush(this.H());
            this.stackPush(this.L());
            this.PC++;
            return 16;
        } else if (currByte === 0xA7) {
            // AND A
            this.A = this.A & this.A;
            this.updateZeroFlag(this.A);
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA0) {
            // AND B
            this.A = this.A & this.B;
            this.updateZeroFlag(this.B);
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA1) {
            // AND C
            this.A = this.A & this.C;
            this.updateZeroFlag(this.C);
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA2) {
            // AND D
            this.A = this.A & this.D;
            this.updateZeroFlag(this.D);
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA3) {
            // AND E
            this.A = this.A & this.E;
            this.updateZeroFlag(this.E);
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA4) {
            // AND H
            this.A = this.A & this.H();
            this.updateZeroFlag(this.H());
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0xA5) {
            // AND L
            this.A = this.A & this.L();
            this.updateZeroFlag(this.L());
            this.clearFlag(SUBTRACTION_FLAG);
            this.setFlag(HALF_CARRY_FLAG);
            this.clearFlag(CARRY_FLAG);            
            this.PC++;
            return 4;
        } else if (currByte === 0x28) {
            // JR Z, r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2;

            if (this.getFlag(ZERO_FLAG)) {
                // jumped
                this.PC += offset;
                return 12;
            } else {
                // not jumped
                return 8;
            }
        } else if (currByte === 0xC0) {
            // RET NZ
            if (!this.getFlag(ZERO_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;    
            } else {
                this.PC++;
                return 8;
            }
        } else if (currByte === 0xC8) {
            // 'RET Z'
            if (this.getFlag(ZERO_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            } else {
              this.PC++;
              return 8;
            }
        } else if (currByte === 0xD0) {
            // 'RET NC'
            if (!this.getFlag(CARRY_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            } else {
                this.PC++;
                return 8;
            }
        } else if (currByte === 0xD8) {
            // 'RET C'
            if (this.getFlag(CARRY_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
              } else {
                this.PC++;
                return 8;
              }
        }  else if (currByte === 0xFA) {
            // 'LD A, (a16)';
            const value = this.readTwoByteValue(this.PC + 1);
            this.A = value;
            this.PC += 3;
            return 16;
        } else if (currByte === 0x3D) {
            // DEC A
            const result = wrappingByteSub(this.A, 1);
            this.updateSubHalfCarryFlag(this.A, 1);
            this.A = result[0];
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.A);
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x2D) {
            // DEC L
            this.decrementL();
            this.updateSubHalfCarryFlag(this.L(), 1);
            this.setFlag(SUBTRACTION_FLAG);
            this.updateZeroFlag(this.L());
            this.clearFlag(CARRY_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x11) {
            // LD DE, d16
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            this.D = msb;
            this.E = lsb;
            this.PC += 3;
            return 12;
        } else if (currByte === 0x7E) {
            // LD A, (HL)
            const value = this.bus.readByte(this.HL);
            this.A = value;
            this.PC++;
            return 8;
        } else if (currByte === 0x6E) {
            // LD L, (HL)
            const value = this.bus.readByte(this.HL);
            this.HL = (this.H() << 8) | value;
            this.PC++;
            return 8;
        } else if (currByte === 0x5E) {
            // LD E, (HL)
            const value = this.bus.readByte(this.HL);
            this.E = value;
            this.PC++;
            return 8;
        } else if (currByte === 0x4E) {
            // LD C, (HL)
            const value = this.bus.readByte(this.HL);
            this.C = value;
            this.PC++;
            return 8;
        } else if (currByte === 0xB7) {
            // OR A
            this.A = this.A | this.A;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        } else if (currByte === 0xC1) {
            // POP BC
            this.C = this.stackPop();
            this.B = this.stackPop();
            this.PC++;
            return 12;
        } else if (currByte === 0xD1) {
            // POP DE
            this.E = this.stackPop();
            this.D = this.stackPop();
            this.PC++;
            return 12;
        } else if (currByte === 0xE1) {
            // POP HL
            const l = this.stackPop();
            const h = this.stackPop();
            this.HL = (h << 8) | l; 
            this.PC++;
            return 12;
        } else if (currByte === 0xF1) {
            // POP AF
            this.F = this.stackPop();
            this.A = this.stackPop();
            this.PC++;
            return 12;
        } else if (currByte === 0x3C) {
            // INC A
            const [result,] = wrappingByteAdd(this.A, 1);
            this.updateHalfCarryFlag(this.A, 1);
            this.A = result;
            this.updateZeroFlag(this.A);
            this.clearFlag(SUBTRACTION_FLAG);
            
            this.PC++;
            return 4;
        } else if (currByte === 0x2C) {
            // INC L
            const [result,] = wrappingByteAdd(this.L(), 1);
            this.updateHalfCarryFlag(this.L(), 1);
            this.HL = (this.HL & 0xFF00) | result;
            this.updateZeroFlag(result);
            this.clearFlag(SUBTRACTION_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x1C) {
            // INC E
            const [result,] = wrappingByteAdd(this.E, 1);
            this.updateHalfCarryFlag(this.E, 1);
            this.E = result;
            this.updateZeroFlag(this.E);
            this.clearFlag(SUBTRACTION_FLAG);

            this.PC++;
            return 4;
        } else if (currByte === 0x34) {
            // INC (HL)
            const value = this.bus.readByte(this.HL);
            const [result,] = wrappingTwoByteAdd(value, 1);
            this.updateHalfCarryFlag(value, 1);
            this.bus.writeByte(this.HL, result);
            this.updateZeroFlag(result);
            this.clearFlag(SUBTRACTION_FLAG);

            this.PC++;
            return 12;
        }

        console.log(`Error: encountered an unsupported opcode of ${displayAsHex(currByte)} at address ${displayAsHex(this.PC)}`);
        return 0;
    }

    // the result was stored in register A
    private updateZeroFlagAndClearOthers() {
        this.updateZeroFlag(this.A);
        this.clearFlag(SUBTRACTION_FLAG);
        this.clearFlag(HALF_CARRY_FLAG);
        this.clearFlag(CARRY_FLAG);        
    }

    // Useful for when pushing 16-bit values on to a stack
    // @param value -> a 16-bit value that is split into two bytes
    // @return twoBytes number[] -> splits single 16 bit value into an array of two bytes.
    private split16BitValueIntoTwoBytes(value: number): number[] {
        const lowerByte = value & 0x00FF;
        const higherByte = value >> 8;
        return [higherByte, lowerByte];
    }

    private stackPush(value: number) {
        this.SP--;
        this.bus.writeByte(this.SP, value);
    }

    private stackPop(): number {
        const value = this.bus.readByte(this.SP);
        this.SP++;
        return value;
    }

    private updateZeroFlag(value: number) {
        if (value === 0x00) {
            // set the zero flag
            this.setFlag(ZERO_FLAG);
        } else {
            this.clearFlag(ZERO_FLAG);
        }
    }

    private updateSubHalfCarryFlag(a: number, b: number) {
        if ((((a & 0xF) - (b & 0xF)) & 0x10) === 0x10) {
            this.setFlag(HALF_CARRY_FLAG);
        } else {
            this.clearFlag(HALF_CARRY_FLAG);
        }
    }

    // for addition operations
    private updateHalfCarryFlag(a: number, b: number) {
        // (((a & 0xf) + (b & 0xf)) & 0x10) == 0x10
        if ((((a & 0xF) + (b & 0xF)) & 0x10) === 0x10) {
            this.setFlag(HALF_CARRY_FLAG);
        } else {
            this.clearFlag(HALF_CARRY_FLAG);
        }
    }
}

const ROM_BANK_0_START_ADDR = 0x0000;
const ROM_BANK_0_END_ADDR = 0x3FFF;

export class Gameboy {
  public cartridge: Cartridge;
  public memory: Memory;
  public bus: MemoryBus;
  public cpu: CPU;
  public ppu: PPU;

  // counter of cycles that has passed since CPU was powered on
  public cyclesCounter: number;

  // debugger information
  private inDebugMode: boolean;
  private debugger: DebugConsole;

  constructor(inDebugMode = false) {
    this.memory = new Memory();
    this.ppu = new PPU();
    this.cpu = new CPU();
    this.bus = new MemoryBus(this.memory, this.ppu, this.cpu);
    this.cpu.setMemoryBus(this.bus);
    this.ppu.setMemoryBus(this.bus);

    this.inDebugMode = inDebugMode;
    this.debugger = new DebugConsole(this);

    //this.sharedStream = fs.createWriteStream('backend.emu.stream');
  }

  public powerOn() {
      if (!this.cartridge.isLoaded) {
          throw new Error('Error powering on the GameBoy due to the cartridge not being loaded yet.');
      }

      if (!this.cartridge.mbc) { // this.cartridge.getRomHeaderInfo().cartridgeType !== 0x00) {
          throw new Error('Error: MBC banking is not yet supported and the rom does require MBC banking');
      }

      if (this.inDebugMode) {
          console.log("The gameboy has powered on in debug mode");
      }

      // initialize the CPU
      this.cpu.initAfterRomLoaded();

      this.cyclesCounter = 0;
  }

  public processInterrupts(): boolean {
      return this.cpu.processInterrupts();
  }

  public async executeNextTick() {
      console.log("next tick");
    const prevProgramCounter = this.cpu.PC;
    const disassembled = this.cpu.disassembleNextInstruction() || "<unknown>";

    if (this.inDebugMode && this.debugger.shouldShowDebugger()) {
      // suspend execution until a key is pressed
      console.log(`* [${displayAsHex(prevProgramCounter)}]: ${disassembled}`);
      this.debugger.showConsole();
    }

    // ExecuteNextInstruction will modify the PC register appropriately
    const cycles = this.cpu.executeInstruction();
    if (cycles === 0) {
        return;
    }
    this.cyclesCounter += cycles;

    // process interrupts
    if (this.processInterrupts()) {
      // interrupt was invoked. Do nothing else and start executing the interrupt immediately
      return;
    }

    this.ppu.step(this.cyclesCounter);

    // check if V Blank Interrupt was requested
    if (this.processInterrupts()) {
      // interrupt was invoked. Do nothing else and start executing the interrupt immediately
      return;
    }    
  }

  public async executeRom() {
    let keepRunning = true;
    while (keepRunning) {
      const prevProgramCounter = this.cpu.PC;
      const disassembled = this.cpu.disassembleNextInstruction() || "<unknown>";
      console.log(`[${displayAsHex(prevProgramCounter)}]: ${disassembled}`);

      if (this.inDebugMode && this.debugger.shouldShowDebugger()) {
        // suspend execution until a key is pressed
        console.log(`* [${displayAsHex(prevProgramCounter)}]: ${disassembled}`);
        this.debugger.showConsole();
      }

      // ExecuteNextInstruction will modify the PC register appropriately
      const cycles = this.cpu.executeInstruction();
      if (cycles === 0) {
          keepRunning = false;
          continue;
      }
      this.cyclesCounter += cycles;
      //cyclesSinceScreenRefresh += cycles;

      // process interrupts
      if (this.processInterrupts()) {
        // interrupt was invoked. Do nothing else and start executing the interrupt immediately
        continue;
      }

      //this.streamUpdates();
      this.ppu.step(this.cyclesCounter);

      //if (cyclesSinceScreenRefresh > 5000 && process.send) {
      //  process.send(this.ppu.getScreenData());
       // cyclesSinceScreenRefresh = 0;
    //}


      // check if V Blank Interrupt was requested
      if (this.processInterrupts()) {
        // interrupt was invoked. Do nothing else and start executing the interrupt immediately
        continue;
      }
    }

    console.log('CPU stopped executing. Most likely due to executing instruction error');
  }

  // when cart is loaded its code is memory mapped to
  // addr 0000-7FFFh of the gameboy's internal ram.
  // addresses 0000-3FFF is ROM Bank 00 (read-only)
  // which contains the Interrupt Table, and Header Information
  public async loadCartridge(cart: Cartridge) {
      this.cartridge = cart;
      await this.cartridge.load();
      this.bus.cartridge = this.cartridge;

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

export class Cartridge {
    public romBytes: Uint8Array;
    public romName: string;
    public isLoaded: boolean;
    public mbc: MemoryBankController;

    constructor(name: string) {
        this.romName = name;
        this.isLoaded = true;
    }

    public async load() {
        this.romBytes = loadRomFromFileSystem(this.romName);
        this.initMBC();
        this.isLoaded = true;
    }

    public initMBC() {
        const romHeader = this.getRomHeaderInfo();
        if (romHeader.cartridgeType === 0x00) { // MBC0
          this.mbc = new MBC0(
              this.romBytes,
              this.getROMSize(romHeader.romSize)
          )
        } else if (romHeader.cartridgeType === 0x01) { // MBC1
          this.mbc = new MBC1(
              this.romBytes,
              this.getROMSize(romHeader.romSize)
          );
        } else {
            // MBC not supported
            console.log(`ERROR: MBC of type ${romHeader.cartridgeType} is not currently supported`);
            this.mbc = null;
        }

    }

    public getROMSize(romSizeHeaderValue) {
        switch (romSizeHeaderValue) {
            case 0x00: return 32768;
            case 0x01: return 65536;
            case 0x02: return 131072;
            case 0x03: return 262144;
            case 0x04: return 524288;
            case 0x05: return 1104280; // is this exact number?
            default: {
                console.log("ERROR: ROM size is currently not supported");
                return 0;
            }
        }
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