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
        this.memory.write(addr, value);

        // if writing to memory mapped vram
        if (addr >= VRAM_ADDR_BEGIN && addr <= VRAM_ADDR_END) {
            this.ppu.write(addr - VRAM_ADDR_BEGIN, value);
        }
    }

    public readByte(addr: number): number {
        return this.memory.read(addr);
    }
}

const ZERO_FLAG_BIT: number = 7;
const SUBTRACTION_FLAG_BIT: number = 6;
const HALF_CARRY_FLAG_BIT: number = 5;
const CARRY_FLAG_BIT: number = 4;

class CPU {
	// registers (unless specified all registers are assumed to be 1 byte)
	A: number;
	B: number;
	C: number;
	D: number;
	E: number;
	F: number;
	H: number;
	L: number;
	SP: number; // 2 bytes
	PC: number; // 2 bytes

	// Reference to RAM
    bus: MemoryBus;
    
    constructor(bus: MemoryBus) {
        this.bus = bus;
    }

    public getRegisterVal(regId: number): number {
        if (regId == 0x00) {
            return this.B;
        } else if (regId == 0x01) {
            return this.C
        } else if (regId == 0x02) {
            return this.D
        } else if (regId == 0x03) {
            return this.E
        } else if (regId == 0x04) {
            return this.H
        } else if (regId == 0x05) {
            return this.L
        } else if (regId == 0x06) {
            return 0 // TODO: return value at address pointed to HL
        } else if (regId == 0x07) {
            return this.A
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
        }
        return 0;
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

  constructor() {
    this.memory = new Memory();
    this.ppu = new PPU();
    this.bus = new MemoryBus(this.memory, this.ppu);
    this.cpu = new CPU(this.bus);
  }

  public powerOn() {
  }

  // when cart is loaded its code is memory mapped to
  // addr 0000-7FFFh of the gameboy's internal ram.
  // addresses 0000-3FFF is ROM Bank 00 (read-only)
  // which contains the Interrupt Table, and Header Information
  public async loadCartridge(cart: Cartridge) {
      this.cartridge = cart;
      await this.cartridge.load();

      // load bank 0 into Gameboy's ram (0x0000 - 0x3FFF)(16K bytes)
      this.loadRomDataIntoMemory(0x0000, 0x0000, 16384);
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

    constructor(name: string) {
        this.romName = name;
    }

    public async load(): Promise<Uint8Array> {
        this.romBytes = await loadRom('tetris');
        return this.romBytes;
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