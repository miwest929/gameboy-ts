"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cartridge = exports.Gameboy = exports.CPU = exports.CARRY_FLAG = exports.HALF_CARRY_FLAG = exports.SUBTRACTION_FLAG = exports.ZERO_FLAG = exports.MemoryBus = exports.Interrupt = void 0;
const rom_loader_1 = require("./rom_loader");
const utils_1 = require("./utils");
const ppu_1 = require("./ppu");
const mbc_1 = require("./mbc");
const debugger_console_1 = require("./debugger_console");
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
// const JOYPAD_INPUT_REGISTER = 0xFF00;
// export class JoypadRegister {
// }
const IE_ADDR = 0xFFFF;
class InterruptEnabledRegister {
    constructor() {
        this.RawValue = 0x00;
    }
    Enable(interruptBit) {
        this.RawValue |= interruptBit;
    }
    VBlankEnabled() {
        return (this.RawValue & 0x01) === 0x01;
    }
    LCDStatEnabled() {
        return (this.RawValue & 0x02) === 0x02;
    }
    TimerEnabled() {
        return (this.RawValue & 0x04) === 0x04;
    }
    SerialEnabled() {
        return (this.RawValue & 0x08) === 0x08;
    }
    JoypadEnabled() {
        return (this.RawValue & 0x10) === 0x10;
    }
}
var Interrupt;
(function (Interrupt) {
    Interrupt[Interrupt["VBLANK"] = 1] = "VBLANK";
    Interrupt[Interrupt["LCDCSTAT"] = 2] = "LCDCSTAT";
    Interrupt[Interrupt["TIMER"] = 4] = "TIMER";
    Interrupt[Interrupt["SERIAL"] = 8] = "SERIAL";
    Interrupt[Interrupt["JOYPAD"] = 16] = "JOYPAD";
    Interrupt[Interrupt["UNUSED1"] = 32] = "UNUSED1";
    Interrupt[Interrupt["UNUSED2"] = 64] = "UNUSED2";
    Interrupt[Interrupt["UNUSED3"] = 128] = "UNUSED3";
})(Interrupt = exports.Interrupt || (exports.Interrupt = {}));
;
var InterruptAddress;
(function (InterruptAddress) {
    InterruptAddress[InterruptAddress["VBLANK"] = 64] = "VBLANK";
    InterruptAddress[InterruptAddress["LCDCSTAT"] = 72] = "LCDCSTAT";
    InterruptAddress[InterruptAddress["TIMER"] = 80] = "TIMER";
    InterruptAddress[InterruptAddress["SERIAL"] = 88] = "SERIAL";
    InterruptAddress[InterruptAddress["JOYPAD"] = 96] = "JOYPAD";
})(InterruptAddress || (InterruptAddress = {}));
const IF_ADDR = 0xFF0F;
class InterruptRequestRegister {
    constructor() {
        this.RawValue = 0x00;
    }
    ClearRequest(interruptBit) {
        this.RawValue &= bitNegation(interruptBit);
    }
    Request(interruptBit) {
        this.RawValue |= interruptBit;
    }
    VBlankRequested() {
        return (this.RawValue & 0x01) === 0x01;
    }
    LCDStatRequested() {
        return (this.RawValue & 0x02) === 0x02;
    }
    TimerRequested() {
        return (this.RawValue & 0x04) === 0x04;
    }
    SerialRequested() {
        return (this.RawValue & 0x08) === 0x08;
    }
    JoypadRequested() {
        return (this.RawValue & 0x10) === 0x10;
    }
}
class Memory {
    constructor() {
        this.ram = new Uint8Array(RAM_SIZE_IN_BYTES);
    }
    write(addr, value) {
        this.ram[addr] = value;
    }
    read(addr) {
        return this.ram[addr];
    }
}
class MemoryBus {
    constructor(memory, ppu, cpu) {
        this.memory = memory;
        this.ppu = ppu;
        this.cpu = cpu;
        this.cartridge = null;
    }
    writeByte(addr, value) {
        // TODO: Implement Echo Ram 0xE000 - 0xFDFF. It's a mirror of WRAM addr 0xC000 - 0xDDFF
        //       Typically not used. Writing to an echo address causes a write to that AND write to associated address in WRAM.
        //       And vice versa.
        if (addr >= ppu_1.Address.VRAM_ADDR_BEGIN && addr <= ppu_1.Address.VRAM_ADDR_END) {
            // if writing to memory mapped vram
            this.memory.write(addr, value);
            this.ppu.writeToVRAM(addr - ppu_1.Address.VRAM_ADDR_BEGIN, value);
        }
        else if (addr >= ppu_1.Address.OAM_ADDR_BEGIN && addr <= ppu_1.Address.OAM_ADDR_END) {
            this.ppu.writeToOAM(addr - ppu_1.Address.OAM_ADDR_BEGIN, value);
        }
        else if (addr === IF_ADDR) {
            // interrupt request register
            this.cpu.IF.RawValue = value;
        }
        else if (addr === IE_ADDR) { // InterruptEnabledRegister
            this.cpu.IE.RawValue = value;
        }
        else if (addr === 0xFF46) { // DMA Transfer and Start Address
            // Initiate DMA Transfer.
            // Source address range is 0xXX00 - 0xXX9F (where XX is the written byte value)
            // Dest. address range is 0xFE00 - 0xFE9F
            //console.log("PERFORMING DMA TRANSER!");
            this.performDMAOAMTransfer(value);
        }
        else if (addr >= 0xff40 && addr <= 0xff4a) { //PPU Special Registers
            this.ppu.writeSpecialRegister(addr, value);
        }
        else if (addr === 0xFF01) {
            // console.log(`OUT: ${String.fromCharCode(value)}`);
        }
        else if (addr >= 0xff00 && addr <= 0xff30) { // I/O Special Registers
            // console.warn("I/O Registers aren't supported yet");
        }
        else if (addr >= 0x0000 && addr <= 0x7FFF) {
            this.cartridge.mbc.WriteByte(addr, value);
        }
        else if (addr >= 0xFEA0 && addr <= 0xFEFF) {
            // Ignore writes to this range as its undocumented
        }
        else {
            this.memory.write(addr, value);
        }
    }
    readByte(addr) {
        if (addr >= ppu_1.Address.VRAM_ADDR_BEGIN && addr <= ppu_1.Address.VRAM_ADDR_END) {
            return this.memory.read(addr); // this.ppu.readFromVRAM(addr - Address.VRAM_ADDR_BEGIN);
        }
        else if (addr >= ppu_1.Address.OAM_ADDR_BEGIN && addr <= ppu_1.Address.OAM_ADDR_END) {
            return this.ppu.readFromOAM(addr - ppu_1.Address.OAM_ADDR_BEGIN);
        }
        else if (addr >= 0xff40 && addr <= 0xff4a) {
            return this.ppu.readFromSpecialRegister(addr);
        }
        else if (addr === IF_ADDR) {
            // interrupt request register
            return this.cpu.IF.RawValue;
        }
        else if (addr === IE_ADDR) {
            // interrupt request register
            return this.cpu.IE.RawValue;
        }
        else if (addr >= 0xFEA0 && addr <= 0xFEFF) { // reading from unused memory should return 0x00
            return 0x00;
        }
        else if (addr >= 0x0000 && addr <= 0x7FFF) {
            return this.cartridge.mbc.ReadByte(addr);
        }
        else if (addr >= 0xFEA0 && addr <= 0xFEFF) {
            return 0x00;
        }
        else {
            return this.memory.read(addr);
        }
    }
    RequestInterrupt(interrupt) {
        if (this.cpu.IME !== 0x00) {
            this.cpu.RequestInterrupt(interrupt);
        }
    }
    performDMAOAMTransfer(baseSrcAddr) {
        const srcAddrStart = (baseSrcAddr << 8) | 0x00;
        //console.log(`Performing DMA OAM Transfer from addr ${srcAddrStart} - ${srcAddrStart + 0x9F} to oam addr ${0xFE00} - ${0xFE9F}`);
        for (let offsetAddr = 0x00; offsetAddr <= 0x9F; offsetAddr++) {
            const value = this.memory.read(srcAddrStart + offsetAddr);
            this.ppu.writeToOAM(0xFE00 + offsetAddr, value);
        }
    }
}
exports.MemoryBus = MemoryBus;
exports.ZERO_FLAG = 0x80; // 0x7F; // set when the instruction results in a value of 0. Otherwise (result different to 0) it is cleared.
exports.SUBTRACTION_FLAG = 0x40; // 0xBF; // set when the instruction is a subtraction.  Otherwise (the instruction is an addition) it is cleared.
exports.HALF_CARRY_FLAG = 0x20; // 0xDF; // set when a carry from bit 3 is produced in arithmetical instructions.  Otherwise it is cleared.
exports.CARRY_FLAG = 0x10; // 0xEF; // set when a carry from bit 7 is produced in arithmetical instructions.  Otherwise it is cleared.
// The second boolean return value determines if a carry has occurred.
// This applies to all wrapping arthmetic functions
const wrappingByteAdd = (value1, value2) => {
    const value = (value1 + value2);
    if (value >= 256) {
        return [value % 256, true];
    }
    else {
        return [value, false];
    }
};
const wrappingTwoByteAdd = (value1, value2) => {
    const value = (value1 + value2);
    if (value >= 65536) {
        return [value % 65536, true];
    }
    else {
        return [value, false];
    }
};
const wrappingByteSub = (value1, value2) => {
    const result = (value1 - value2) % 256;
    return result >= 0 ? [result, false] : [256 + result, true];
};
const wrappingTwoByteSub = (value1, value2) => {
    const result = (value1 - value2) % 65536;
    return result >= 0 ? [result, false] : [65536 + result, true];
};
const bitNegation = (value) => {
    let binaryString = value.toString(2);
    let negatedBinary = "";
    for (let i = 0; i < binaryString.length; i++) {
        negatedBinary += binaryString[i] === '1' ? '0' : '1';
    }
    return parseInt(negatedBinary, 2);
};
const makeSigned = (value, bytesCount) => {
    let msbMask = 0x80;
    if (bytesCount === 2) {
        msbMask = 0x8000;
    }
    if ((value & msbMask) > 0) {
        // value is negative
        return -(bitNegation(value) + 1);
    }
    return value;
};
// This emulator doesn't run the bootstrap rom. But it
// needs to initialize the registers to their values as 
// if the bootstrap has run
const INITIAL_A_REG_VALUE = 0x01;
const INITIAL_F_REG_VALUE = 0xB0;
const INITIAL_B_REG_VALUE = 0x00;
const INITIAL_C_REG_VALUE = 0x13;
const INITIAL_D_REG_VALUE = 0x00;
const INITIAL_E_REG_VALUE = 0xD8;
const INITIAL_HL_REG_VALUE = 0x014D;
// used for delaying disabling interrupts
const INTERRUPT_DELAY_COUNTER_INACTIVE = -1;
class CPU {
    constructor() {
        this.A = INITIAL_A_REG_VALUE;
        this.B = INITIAL_B_REG_VALUE;
        this.C = INITIAL_C_REG_VALUE;
        this.D = INITIAL_D_REG_VALUE;
        this.E = INITIAL_E_REG_VALUE;
        this.HL = INITIAL_HL_REG_VALUE;
        // NOTE: According to BGB Debugger. This register is initialized to 0xB0 (eg: zero, hc, and carry flags on)
        this.F = INITIAL_F_REG_VALUE; // 0xB0 = 0x1011xxxx
        this.Flags = {
            zeroFlag: true,
            subtractionFlag: false,
            halfCarryFlag: true,
            carryFlag: true
        };
        this.disableInterruptsCounter = INTERRUPT_DELAY_COUNTER_INACTIVE; // -1 means to ignore this counter
        this.shouldEnableInterrupts = false;
    }
    setMemoryBus(bus) {
        this.bus = bus;
    }
    RequestInterrupt(interruptBit) {
        this.IF.Request(interruptBit);
    }
    initAfterRomLoaded() {
        this.PC = 0x100; // starting address in the rom. The instruction at this address should be a JMP that jumps to the first
        // actual instruction to be executed.
        this.SP = 0xFFFE;
        // initialize Interrupt related flag registers
        this.IME = 0x00;
        this.IF = new InterruptRequestRegister();
        this.IE = new InterruptEnabledRegister();
    }
    H() {
        return (this.HL & 0xFF00) >> 8;
    }
    // decrement the H portion of HL register by 1
    decrementH() {
        const result = wrappingByteSub(this.H(), 1);
        this.updateH(result[0]);
    }
    updateH(value) {
        this.HL = (value << 8) | this.L();
    }
    // decrement the H portion of HL register by 1
    decrementL() {
        const result = wrappingByteSub(this.L(), 1);
        this.updateL(result[0]);
    }
    updateL(value) {
        this.HL = (this.H() << 8) | value;
    }
    L() {
        return this.HL & 0x00FF;
    }
    DE() {
        return (this.D << 8) | this.E;
    }
    BC() {
        return (this.B << 8) | this.C;
    }
    decrementBC() {
        const result = wrappingTwoByteSub(this.BC(), 1);
        this.B = result[0] >> 8;
        this.C = result[0] & 0x00FF;
    }
    addOneByte(val1, val2, carryVal = 0) {
        const result = wrappingByteAdd(val1, val2 + carryVal);
        this.updateHalfCarryFlag(val1, val2);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
        return result[0];
    }
    subOneByte(val1, val2, carryVal = 0) {
        const result = wrappingByteSub(val1, val2 + carryVal);
        this.updateSubHalfCarryFlag(val1, val2);
        this.setFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.ZERO_FLAG);
        result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
        return result[0];
    }
    incrementBC() {
        const result = wrappingTwoByteAdd(this.BC(), 1);
        this.B = result[0] >> 8;
        this.C = result[0] & 0x00FF;
    }
    incrementDE() {
        const result = wrappingTwoByteAdd(this.DE(), 1);
        this.D = result[0] >> 8;
        this.E = result[0] & 0x00FF;
    }
    getFlag(flag) {
        if (flag === exports.SUBTRACTION_FLAG) {
            return this.Flags.subtractionFlag;
        }
        else if (flag === exports.ZERO_FLAG) {
            return this.Flags.zeroFlag;
        }
        else if (flag === exports.HALF_CARRY_FLAG) {
            return this.Flags.halfCarryFlag;
        }
        else if (flag === exports.CARRY_FLAG) {
            return this.Flags.carryFlag;
        }
    }
    clearFlag(flag) {
        if (flag === exports.SUBTRACTION_FLAG) {
            this.Flags.subtractionFlag = false;
        }
        else if (flag === exports.ZERO_FLAG) {
            this.Flags.zeroFlag = false;
        }
        else if (flag === exports.HALF_CARRY_FLAG) {
            this.Flags.halfCarryFlag = false;
        }
        else if (flag === exports.CARRY_FLAG) {
            this.Flags.carryFlag = false;
        }
    }
    setFlag(flag) {
        if (flag === exports.SUBTRACTION_FLAG) {
            this.Flags.subtractionFlag = true;
        }
        else if (flag === exports.ZERO_FLAG) {
            this.Flags.zeroFlag = true;
        }
        else if (flag === exports.HALF_CARRY_FLAG) {
            this.Flags.halfCarryFlag = true;
        }
        else if (flag === exports.CARRY_FLAG) {
            this.Flags.carryFlag = true;
        }
    }
    loadFlags(value) {
        return {
            subtractionFlag: (value & 0x80) === 0x80,
            zeroFlag: (value & 0x40) === 0x40,
            halfCarryFlag: (value & 0x20) === 0x20,
            carryFlag: (value & 0x10) === 0x10
        };
    }
    serializeFlags(flags) {
        let value = 0x00;
        if (flags.subtractionFlag) {
            value |= 0x80;
        }
        if (flags.zeroFlag) {
            value |= 0x40;
        }
        if (flags.halfCarryFlag) {
            value |= 0x20;
        }
        if (flags.carryFlag) {
            value |= 0x10;
        }
        return value;
    }
    shouldDisableInterrupts() {
        if (this.disableInterruptsCounter === INTERRUPT_DELAY_COUNTER_INACTIVE) {
            return false;
        }
        if (this.disableInterruptsCounter === 0) {
            return true;
        }
        this.disableInterruptsCounter--;
        return false;
    }
    disableInterrupts() {
        this.IME = 0x00;
        this.disableInterruptsCounter = INTERRUPT_DELAY_COUNTER_INACTIVE; // prevent interrupts from being disabled again
    }
    startDisableInterrupt() {
        this.disableInterruptsCounter = 1;
    }
    enableInterrupts() {
        this.IME = 0x01;
        this.shouldEnableInterrupts = false;
    }
    // @return boolean -> true if interrupt was invoked, false otherwise;
    processInterrupts() {
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
        }
        else if (this.IE.LCDStatEnabled() && this.IF.LCDStatRequested()) {
            this.IF.ClearRequest(Interrupt.LCDCSTAT);
            this.PC = InterruptAddress.LCDCSTAT;
            wasInterruptInvoked = true;
        }
        else if (this.IE.TimerEnabled() && this.IF.TimerRequested()) {
            this.IF.ClearRequest(Interrupt.TIMER);
            this.PC = InterruptAddress.TIMER;
            wasInterruptInvoked = true;
        }
        else if (this.IE.SerialEnabled() && this.IF.SerialRequested()) {
            this.IF.ClearRequest(Interrupt.SERIAL);
            this.PC = InterruptAddress.SERIAL;
            wasInterruptInvoked = true;
        }
        else if (this.IE.JoypadEnabled() && this.IF.JoypadRequested()) {
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
            // console.log(`****************** INVOKED INTERRUPT. PC = ${this.PC} *********************`);
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
    disassembleNextInstruction() {
        const op = this.bus.readByte(this.PC);
        this.lastExecutedOpCode = op;
        if (op === 0x31) {
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `LD SP, ${utils_1.displayAsHex(addr)}`;
        }
        else if (op === 0x00) {
            return "NOP";
        }
        else if (op === 0xC3) {
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `JP ${utils_1.displayAsHex(addr)}`;
        }
        else if (op === 0xAF) {
            return "XOR A";
        }
        else if (op === 0x21) {
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const value = (msb << 8) | lsb;
            return `LD HL, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0x0E) {
            const value = this.bus.readByte(this.PC + 1);
            return `LD C, ${value}`;
        }
        else if (op === 0x06) {
            const value = this.bus.readByte(this.PC + 1);
            return `LD B, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0x32) {
            return "LD (HL-), A";
        }
        else if (op === 0x05) {
            return "DEC B";
        }
        else if (op === 0x20) {
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            if (!this.Flags.zeroFlag) {
                return `JR NZ, ${offset} [jumped]`;
            }
            else {
                return `JR NZ, ${offset} [not jumped]`;
            }
        }
        else if (op === 0x0D) {
            return `DEC C`;
        }
        else if (op === 0x1D) {
            return `DEC E`;
        }
        else if (op === 0x16) {
            const value = this.bus.readByte(this.PC + 1);
            return `LD D, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0x1F) {
            return "RRA";
        }
        else if (op === 0x25) {
            return "DEC H";
        }
        else if (op === 0x15) {
            return "DEC D";
        }
        else if (op === 0xB0) {
            return "OR B";
        }
        else if (op === 0x14) {
            return "INC D";
        }
        else if (op === 0x7B) {
            return "LD A, E";
        }
        else if (op === 0xBF) {
            return "CP A";
        }
        else if (op === 0x29) {
            return "ADD HL, HL";
        }
        else if (op === 0x19) {
            return "ADD HL, DE";
        }
        else if (op === 0x77) {
            return "LD (HL), A";
        }
        else if (op === 0x07) {
            return "RLCA [NOT IMPL]";
        }
        else if (op === 0x08) {
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `LD (${utils_1.displayAsHex(addr)}), SP`;
        }
        else if (op === 0x12) {
            return "LD (DE), A";
        }
        else if (op === 0x0C) {
            return "INC C";
        }
        else if (op === 0xD2) {
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            return `JP NC, ${utils_1.displayAsHex(addr)}`;
        }
        else if (op === 0x10) {
            console.log("STOP 0 (not implemented. no button press support yet");
        }
        else if (op === 0x18) {
            let offset = this.bus.readByte(this.PC + 1);
            return `JR ${offset}`;
        }
        else if (op === 0x7F) {
            return "LD A, A";
        }
        else if (op === 0x7C) {
            return "LD A, H";
        }
        else if (op === 0x78) {
            return "LD A, B";
        }
        else if (op === 0x79) {
            return "LD A, C";
        }
        else if (op === 0xFF) {
            return "RST 38H";
        }
        else if (op === 0x3E) {
            let value = this.bus.readByte(this.PC + 1);
            return `LD A, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0xF3) {
            return "DI";
        }
        else if (op === 0xE0) {
            let value = this.bus.readByte(this.PC + 1);
            return `LDH (${0xFF00 + value}), A`;
        }
        else if (op === 0xF0) {
            let value = this.bus.readByte(this.PC + 1);
            return `LDH A, (${0xFF00 + value})`;
        }
        else if (op === 0xFE) {
            let value = this.bus.readByte(this.PC + 1);
            return `CP ${value}`;
        }
        else if (op === 0x36) {
            const value = this.bus.readByte(this.PC + 1);
            return `LD (HL), ${value}`;
        }
        else if (op === 0xEA) {
            const addr = this.readTwoByteValue(this.PC + 1);
            return `LDH (${addr}), A`;
        }
        else if (op === 0x2A) {
            return "LD A, (HL+)";
        }
        else if (op === 0xE2) {
            return `LD (C), A`;
        }
        else if (op === 0xF2) {
            return `LD A, (C)`;
        }
        else if (op === 0xCD) {
            const addr = this.readTwoByteValue(this.PC + 1);
            return `CALL ${utils_1.displayAsHex(addr)}`;
        }
        else if (op === 0x01) {
            const value = this.readTwoByteValue(this.PC + 1);
            return `LD BC, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0xD9) {
            return 'RETI';
        }
        else if (op === 0xC9) {
            return `RET <two-byte-stack-pop>`;
        }
        else if (op === 0xFB) {
            return 'EI';
        }
        else if (op === 0x0B) {
            return 'DEC BC';
        }
        else if (op === 0xB1) {
            return 'OR C';
        }
        else if (op === 0xF5) {
            return 'PUSH AF';
        }
        else if (op === 0xC5) {
            return 'PUSH BC';
        }
        else if (op === 0xD5) {
            return 'PUSH DE';
        }
        else if (op === 0xE5) {
            return 'PUSH HL';
        }
        else if (op === 0xA7) {
            return 'AND A';
        }
        else if (op === 0xA0) {
            return 'AND B';
        }
        else if (op === 0xA1) {
            return 'AND C';
        }
        else if (op === 0xA2) {
            return 'AND D';
        }
        else if (op === 0xA3) {
            return 'AND E';
        }
        else if (op === 0xA4) {
            return 'AND H';
        }
        else if (op === 0xA5) {
            return 'AND L';
        }
        else if (op === 0x28) {
            return 'JR Z, r8';
        }
        else if (op === 0xC0) {
            return 'RET NZ';
        }
        else if (op === 0xC8) {
            return 'RET Z';
        }
        else if (op === 0xD0) {
            return 'RET NC';
        }
        else if (op === 0xD8) {
            return 'RET C';
        }
        else if (op === 0xFA) {
            return 'LD A, (a16)';
        }
        else if (op == 0x3D) {
            return 'DEC A';
        }
        else if (op == 0x2D) {
            return 'DEC L';
        }
        else if (op == 0x11) {
            const value = this.readTwoByteValue(this.PC + 1);
            return `LD DE, ${value}`;
        }
        else if (op === 0x7E) {
            return 'LD A, (HL)';
        }
        else if (op === 0x6E) {
            return 'LD L, (HL)';
        }
        else if (op === 0x5E) {
            return 'LD E, (HL)';
        }
        else if (op === 0x4E) {
            return 'LD C, (HL)';
        }
        else if (op === 0xB7) {
            return 'OR A';
        }
        else if (op === 0xC1) {
            return 'POP BC';
        }
        else if (op === 0xD1) {
            return 'POP DE';
        }
        else if (op === 0xE1) {
            return 'POP HL';
        }
        else if (op === 0xF1) {
            return 'POP AF';
        }
        else if (op === 0x3C) {
            return 'INC A';
        }
        else if (op === 0x2C) {
            return 'INC L';
        }
        else if (op === 0x1C) {
            return 'INC E';
        }
        else if (op === 0x34) {
            return 'INC (HL)';
        }
        else if (op === 0x2F) {
            return 'CPL';
        }
        else if (op === 0xE6) {
            return 'AND A, d8';
        }
        else if (op === 0x47) {
            return 'LD B, A';
        }
        else if (op === 0x46) {
            return 'LD B, (HL)';
        }
        else if (op === 0x45) {
            return 'LD B, L';
        }
        else if (op === 0x44) {
            return 'LD B, H';
        }
        else if (op === 0x43) {
            return 'LD B, E';
        }
        else if (op === 0x42) {
            return 'LD B, D';
        }
        else if (op === 0x41) {
            return 'LD B, C';
        }
        else if (op === 0x40) {
            return 'LD B, B';
        }
        else if (op === 0x4F) {
            return 'LD C, A';
        }
        else if (op === 0x4D) {
            return 'LD C, L';
        }
        else if (op === 0x4C) {
            return 'LD C, H';
        }
        else if (op === 0x4B) {
            return 'LD C, E';
        }
        else if (op === 0x4A) {
            return 'LD C, D';
        }
        else if (op === 0x49) {
            return 'LD C, C';
        }
        else if (op === 0xA9) {
            return 'XOR C';
        }
        else if (op === 0x48) {
            return 'LD C, B';
        }
        else if (op === 0xEF) {
            return 'RST 28h';
        }
        else if (op === 0x87) {
            return 'ADD A';
        }
        else if (op === 0x5F) {
            return 'LD E, A';
        }
        else if (op === 0x5D) {
            return 'LD E, L';
        }
        else if (op === 0x5C) {
            return 'LD E, H';
        }
        else if (op === 0x5B) {
            return 'LD E, E';
        }
        else if (op === 0x5A) {
            return 'LD E, D';
        }
        else if (op === 0x59) {
            return 'LD E, C';
        }
        else if (op === 0x58) {
            return 'LD E, B';
        }
        else if (op === 0x23) {
            return 'INC HL';
        }
        else if (op === 0x24) {
            return 'INC H';
        }
        else if (op === 0x56) {
            return 'LD D, (HL)';
        }
        else if (op === 0x57) {
            return 'LD D, A';
        }
        else if (op === 0x55) {
            return 'LD D, L';
        }
        else if (op === 0x54) {
            return 'LD D, H';
        }
        else if (op === 0x53) {
            return 'LD D, E';
        }
        else if (op === 0x52) {
            return 'LD D, D';
        }
        else if (op === 0x51) {
            return 'LD D, C';
        }
        else if (op === 0x50) {
            return 'LD D, B';
        }
        else if (op === 0xE9) {
            return 'JP (HL)';
        }
        else if (op === 0x13) {
            return 'INC DE';
        }
        else if (op === 0x1A) {
            return 'LD A, (DE)';
        }
        else if (op === 0x22) {
            return 'LD (HL+), A';
        }
        else if (op === 0xCA) {
            return 'JP Z, a16';
        }
        else if (op === 0x35) {
            return 'DEC (HL)';
        }
        else if (op === 0x09) {
            return 'ADD HL, BC';
        }
        else if (op === 0x69) {
            return 'LD L, C';
        }
        else if (op === 0x60) {
            return 'LD H, B';
        }
        else if (op === 0x0A) {
            return 'LD A, (BC)';
        }
        else if (op === 0x03) {
            return 'INC BC';
        }
        else if (op === 0x80) {
            return 'ADD A, B';
        }
        else if (op === 0x81) {
            return 'ADD A, C';
        }
        else if (op === 0x82) {
            return 'ADD A, D';
        }
        else if (op === 0x83) {
            return 'ADD A, E';
        }
        else if (op === 0x84) {
            return 'ADD A, H';
        }
        else if (op === 0x85) {
            return 'ADD A, L';
        }
        else if (op === 0x86) {
            return 'ADD A, (HL)';
        }
        else if (op === 0x88) {
            return 'ADC A, B';
        }
        else if (op === 0x89) {
            return 'ADC A, C';
        }
        else if (op === 0x8A) {
            return 'ADC A, D';
        }
        else if (op === 0x8B) {
            return 'ADC A, E';
        }
        else if (op === 0x8C) {
            return 'ADC A, H';
        }
        else if (op === 0x8D) {
            return 'ADC A, L';
        }
        else if (op === 0x8E) {
            return 'ADC A, (HL)';
        }
        else if (op === 0x8F) {
            return 'ADC A, A';
        }
        else if (op === 0x6F) {
            return 'LD L, A';
        }
        else if (op === 0x6D) {
            return 'LD L, L';
        }
        else if (op === 0x6C) {
            return 'LD L, H';
        }
        else if (op === 0x6B) {
            return 'LD L, E';
        }
        else if (op === 0x6A) {
            return 'LD L, D';
        }
        else if (op === 0x68) {
            return 'LD L, B';
        }
        else if (op === 0x61) {
            return 'LD H, C';
        }
        else if (op === 0x62) {
            return 'LD H, D';
        }
        else if (op === 0x63) {
            return 'LD H, E';
        }
        else if (op === 0x64) {
            return 'LD H, H';
        }
        else if (op === 0x65) {
            return 'LD H, L';
        }
        else if (op === 0x66) {
            return 'LD H, (HL)';
        }
        else if (op === 0x67) {
            return 'LD H, A';
        }
        else if (op === 0x7A) {
            return 'LD A, D';
        }
        else if (op === 0x7D) {
            return 'LD A, L';
        }
        else if (op === 0x70) {
            return 'LD (HL), B';
        }
        else if (op === 0x71) {
            return 'LD (HL), C';
        }
        else if (op === 0xC2) {
            const addr = this.readTwoByteValue(this.PC + 1);
            return `JP NZ, ${addr}`;
        }
        else if (op === 0xC6) {
            // ADD A, d8
            const value = this.readTwoByteValue(this.PC + 1);
            return `ADD A, ${value}`;
        }
        else if (op === 0xEE) {
            const value = this.bus.readByte(this.PC + 1);
            return `XOR ${value}`;
        }
        else if (op === 0xC4) {
            const addr = this.readTwoByteValue(this.PC + 1);
            return `CALL NZ, ${utils_1.displayAsHex(addr)}`;
        }
        else if (op === 0xD6) {
            const value = this.bus.readByte(this.PC + 1);
            return `SUB ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0xAE) {
            return `XOR (HL)`;
        }
        else if (op === 0x26) {
            const value = this.bus.readByte(this.PC + 1);
            return `LD H, ${value}`;
        }
        else if (op === 0x38) {
            const value = this.bus.readByte(this.PC + 1);
            return `JR C, ${utils_1.displayAsHex(value)}`;
        }
        else if (op === 0xCB) {
            let nextInstrByte = this.bus.readByte(this.PC + 1);
            this.lastExecutedOpCode = (this.lastExecutedOpCode << 8) | nextInstrByte;
            switch (nextInstrByte) {
                case 0x37:
                    return 'SWAP A';
                case 0x30:
                    return 'SWAP B';
                case 0x31:
                    return 'SWAP C';
                case 0x32:
                    return 'SWAP D';
                case 0x33:
                    return 'SWAP E';
                case 0x34:
                    return 'SWAP H';
                case 0x35:
                    return 'SWAP L';
                case 0x36:
                    return 'SWAP (HL)';
                case 0x87:
                    return 'RES 0, A';
                case 0x86:
                    return 'RES 0, (HL)';
                case 0x27:
                    return 'SLA A';
                case 0x78:
                    return 'BIT 7, B';
                case 0x79:
                    return 'BIT 7, C';
                case 0x7A:
                    return 'BIT 7, D';
                case 0x7B:
                    return 'BIT 7, E';
                case 0x7C:
                    return 'BIT 7, H';
                case 0x7D:
                    return 'BIT 7, L';
                case 0x7E:
                    return 'BIT 7, (HL)';
                case 0x7F:
                    return 'BIT 7, A';
                case 0x50:
                    return 'BIT 2, B';
                case 0x51:
                    return 'BIT 2, C';
                case 0x52:
                    return 'BIT 2, D';
                case 0x53:
                    return 'BIT 2, E';
                case 0x54:
                    return 'BIT 2, H';
                case 0x55:
                    return 'BIT 2, L';
                case 0x56:
                    return 'BIT 2, (HL)';
                case 0x57:
                    return 'BIT 2, A';
                case 0x38:
                    return 'SRL B';
                case 0x19:
                    return 'RR C';
                case 0x18:
                    return 'RR B';
                case 0x1A:
                    return 'RR D';
                case 0x1B:
                    return 'RR E';
                case 0x1C:
                    return 'RR H';
                case 0x1D:
                    return 'RR L';
                case 0x1E:
                    return 'RR (HL)';
                case 0x1F:
                    return 'RR A';
                default:
                    return '<unknown>';
            }
        }
    }
    readTwoByteValue(baseAddr) {
        const lsb = this.bus.readByte(baseAddr);
        const msb = this.bus.readByte(baseAddr + 1);
        return (msb << 8) | lsb;
    }
    // Due to JMP, RET instructions this fn must modify the PC register itself.
    // The return value is the number of cycles the instruction took
    // Instruction cycle counts can be found here: http://www.pastraiser.com/cpu/gameboy/gameboy_opcodes.html
    // @return cyclesConsumed: number = The number of cycles the just executed instruction took
    executeInstruction() {
        if (this.shouldDisableInterrupts()) {
            this.disableInterrupts();
        }
        const op = this.bus.readByte(this.PC);
        if (op === 0x31) {
            // LD SP, N
            // 3 byte instruction
            this.SP = this.readTwoByteValue(this.PC + 1);
            this.PC += 3;
            return 12;
        }
        else if (op === 0x00) {
            // NOP
            this.PC++;
            return 4;
        }
        else if (op === 0xC3) {
            // JP 2-byte-address
            this.PC = this.readTwoByteValue(this.PC + 1);
            ;
            return 16;
        }
        else if (op === 0xAF) {
            // XOR A  (1 byte, 4 cycles)
            this.A = this.A ^ this.A;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0x21) {
            // LD HL, d16 (3 bytes, 12 cycles)
            this.HL = this.readTwoByteValue(this.PC + 1);
            this.PC += 3;
            return 12;
        }
        else if (op === 0x0E) {
            // LD C,d8
            this.C = this.bus.readByte(this.PC + 1);
            ;
            this.PC += 2;
            return 8;
        }
        else if (op === 0x06) {
            // LD B,d8
            this.B = this.bus.readByte(this.PC + 1);
            this.PC += 2;
            return 8;
        }
        else if (op === 0x32) {
            // Put A into memory address HL. Decrement HL.
            // LD (HL-),A
            this.bus.writeByte(this.HL, this.A);
            const result = wrappingTwoByteSub(this.HL, 1);
            this.HL = result[0];
            this.PC++;
            return 8;
        }
        else if (op === 0x05) {
            // DEC B
            const result = wrappingByteSub(this.B, 1);
            this.updateSubHalfCarryFlag(this.B, 1);
            this.B = result[0];
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.B);
            this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x20) {
            // branch if not zero
            // JR NotZero,r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2;
            if (!this.getFlag(exports.ZERO_FLAG)) {
                // jumped
                this.PC += offset;
                return 12;
            }
            else {
                // not jumped
                return 8;
            }
        }
        else if (op === 0x0D) {
            // DEC C
            const result = wrappingByteSub(this.C, 1);
            this.updateSubHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.C);
            this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x1D) {
            // DEC E
            const result = wrappingByteSub(this.E, 1);
            this.updateSubHalfCarryFlag(this.E, 1);
            this.E = result[0];
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x16) {
            // LD D,d8
            const value = this.bus.readByte(this.PC + 1);
            this.D = value;
            this.PC += 2;
            return 8;
        }
        else if (op === 0x1F) {
            // Rotate A right through Carry flag.
            // RRA
            const newCarryValue = (this.A & 0x01) !== 0;
            const oldCarryValue = this.getFlag(exports.CARRY_FLAG) ? 0x01 : 0x00;
            this.A = (this.A >> 1) | (oldCarryValue << 7);
            if (newCarryValue) {
                this.setFlag(exports.CARRY_FLAG);
            }
            else {
                this.clearFlag(exports.CARRY_FLAG);
            }
            this.clearFlag(exports.ZERO_FLAG);
            this.clearFlag(exports.HALF_CARRY_FLAG);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x25) {
            // DEC H
            this.decrementH();
            this.updateSubHalfCarryFlag(this.H(), 1);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x15) {
            // DEC D
            const result = wrappingByteSub(this.D, 1);
            this.updateSubHalfCarryFlag(this.D, 1);
            this.D = result[0];
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.D);
            this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0xB0) {
            // Logical OR register B with register A, result in A.
            // OR B
            this.A = this.A | this.B;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0x14) {
            // INC D
            let result = wrappingByteAdd(this.D, 1);
            // check for half-carry
            this.updateHalfCarryFlag(this.D, 1);
            this.D = result[0];
            this.updateZeroFlag(this.D);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x7B) {
            // LD A, E
            this.A = this.E;
            this.PC++;
            return 4;
        }
        else if (op === 0xBF) {
            // compare A with A. Set flags as if they are equal
            // CP A
            this.setFlag(exports.ZERO_FLAG);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.clearFlag(exports.HALF_CARRY_FLAG);
            this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x29) {
            // ADD HL,HL
            const result = wrappingTwoByteAdd(this.HL, this.HL);
            this.updateHalfCarryFlag(this.HL, this.HL);
            this.HL = result[0];
            this.clearFlag(exports.SUBTRACTION_FLAG);
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 8;
        }
        else if (op === 0x19) {
            // ADD HL,DE
            const result = wrappingTwoByteAdd(this.HL, this.DE());
            this.updateHalfCarryFlag(this.HL, this.DE());
            this.HL = result[0];
            this.clearFlag(exports.SUBTRACTION_FLAG);
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 8;
        }
        else if (op === 0x77) {
            // LD (HL),A
            this.bus.writeByte(this.HL, this.A);
            this.PC++;
            return 8;
        }
        else if (op === 0x07) {
            // RLCA
            console.log("RLCA [NOT IMPL]");
            this.PC++;
            return 4;
        }
        else if (op === 0x08) {
            // LD (a16),SP
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            this.bus.writeByte(addr, this.SP);
            this.PC += 3;
            return 20;
        }
        else if (op === 0x12) {
            // LD (DE), A
            this.bus.writeByte(this.DE(), this.A);
            this.PC++;
            return 8;
        }
        else if (op === 0x0C) {
            // INC C
            const result = wrappingByteAdd(this.C, 1);
            this.updateHalfCarryFlag(this.C, 1);
            this.C = result[0];
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0xD2) {
            // JP NC, a16
            let lsb = this.bus.readByte(this.PC + 1);
            let msb = this.bus.readByte(this.PC + 2);
            const addr = (msb << 8) | lsb;
            if (!this.getFlag(exports.CARRY_FLAG)) {
                this.PC = addr;
                return 16;
            }
            else {
                this.PC += 2;
                return 12;
            }
        }
        else if (op === 0x10) {
            // Halt CPU & LCD display until button pressed.
            // STOP 0
            this.PC += 2;
            return 4;
        }
        else if (op === 0x18) {
            // Add n to current address and jump to it.
            // JR r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2; // move to next instruction then add offset
            const addr = this.PC + offset;
            this.PC = addr;
            return 8;
        }
        else if (op === 0x7F) {
            // LD A,A
            this.A = this.A;
            this.PC++;
            return 4;
        }
        else if (op === 0x7C) {
            // LD A,H
            this.A = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x78) {
            // LD A,B
            this.A = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0x79) {
            // LD A,C
            this.A = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0xFF) {
            // Push present address onto stack. Jump to address $0000 + 56 (0x38).
            // RST 38H
            this.PC++; // push the next address onto the stack
            //this.stackPush(this.PC & 0x00FF);
            //this.stackPush((this.PC >> 8);
            this.PC = 0x38;
            return 16;
        }
        else if (op === 0x3E) {
            // LD A, d8
            let value = this.bus.readByte(this.PC + 1);
            this.A = value;
            this.PC += 2;
            return 8;
        }
        else if (op === 0xF3) {
            /*
                disables interrupts but not
                immediately. Interrupts are disabled after
                instruction after DI is executed.
            */
            // DI
            this.startDisableInterrupt();
            this.PC++;
            return 4;
        }
        else if (op === 0xE0) {
            // LDH (a8),A
            let value = this.bus.readByte(this.PC + 1);
            this.bus.writeByte(0xFF00 + value, this.A);
            this.PC += 2;
            return 12;
        }
        else if (op === 0xF0) {
            /// LDH A, (a8)
            let value = this.bus.readByte(this.PC + 1);
            this.A = this.bus.readByte(0xFF00 + value);
            this.PC += 2;
            return 12;
        }
        else if (op === 0xFE) {
            // Compare A with n. This is basically an A - n subtraction instruction but the results are thrown away.
            // CP d8
            let value = this.bus.readByte(this.PC + 1);
            let result = wrappingByteSub(this.A, value);
            this.updateZeroFlag(result[0]);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateSubHalfCarryFlag(this.A, value);
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC += 2;
            return 8;
        }
        else if (op === 0x36) {
            // LD (HL), d8
            const value = this.bus.readByte(this.PC + 1);
            this.bus.writeByte(this.HL, value);
            this.PC += 2;
            return 12;
        }
        else if (op === 0xEA) {
            // LDH (a16), A
            const addr = this.readTwoByteValue(this.PC + 1);
            this.bus.writeByte(addr, this.A);
            this.PC += 3;
            return 16;
        }
        else if (op === 0x2A) {
            // LD A, (HL+)     [1 byte, 8 cycles]
            this.A = this.bus.readByte(this.HL);
            this.HL++;
            this.PC++;
            return 8;
        }
        else if (op === 0xE2) {
            // LD (C), A
            this.bus.writeByte(0xFF00 + this.C, this.A);
            this.PC++;
            return 8;
        }
        else if (op === 0xF2) {
            // LD A, (C)
            this.A = this.bus.readByte(0xFF00 + this.C);
            this.PC++;
            return 8;
        }
        else if (op === 0xCD) {
            // CALL a16
            const addr = this.readTwoByteValue(this.PC + 1);
            // push address after this instruction on to the stack
            const returnAddr = this.PC + 3; // 3 because this instruction is 3 bytes long
            const [higherByte, lowerByte] = this.split16BitValueIntoTwoBytes(returnAddr);
            this.stackPush(higherByte);
            this.stackPush(lowerByte);
            this.PC = addr;
            return 24;
        }
        else if (op === 0x01) {
            // LD BC, d16
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            this.B = msb;
            this.C = lsb;
            this.PC += 3;
            return 12;
        }
        else if (op === 0xD9) {
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
        }
        else if (op === 0xC9) {
            // RET
            // Pop two bytes from stack & jump to that address.
            // TODO: Verify that popping two bytes from stack works like this. Use other emulators as implementation reference
            const lsb = this.stackPop();
            const msb = this.stackPop();
            const addr = (msb << 8) | lsb;
            this.PC = addr;
            return 16;
        }
        else if (op === 0xFB) {
            // EI
            this.shouldEnableInterrupts = true;
            this.PC++;
            return 4;
        }
        else if (op === 0x0B) {
            // DEC BC
            this.decrementBC();
            this.PC++;
            return 8;
        }
        else if (op === 0xB1) {
            // OR C
            this.A = this.A | this.C;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xF5) {
            // PUSH AF
            this.stackPush(this.A);
            this.stackPush(this.serializeFlags(this.Flags));
            this.PC++;
            return 16;
        }
        else if (op === 0xC5) {
            // PUSH BC
            this.stackPush(this.B);
            this.stackPush(this.C);
            this.PC++;
            return 16;
        }
        else if (op === 0xD5) {
            // PUSH DE
            this.stackPush(this.D);
            this.stackPush(this.E);
            this.PC++;
            return 16;
        }
        else if (op === 0xE5) {
            // PUSH HL
            this.stackPush(this.H());
            this.stackPush(this.L());
            this.PC++;
            return 16;
        }
        else if (op === 0xA7) {
            // AND A           
            this.PC++;
            return this.executeAnd(this.A);
        }
        else if (op === 0xA0) {
            // AND B           
            this.PC++;
            return this.executeAnd(this.B);
        }
        else if (op === 0xA1) {
            // AND C
            this.PC++;
            return this.executeAnd(this.C);
        }
        else if (op === 0xA2) {
            // AND D
            this.PC++;
            return this.executeAnd(this.D);
        }
        else if (op === 0xA3) {
            // AND E
            this.PC++;
            return this.executeAnd(this.E);
        }
        else if (op === 0xA4) {
            // AND H
            this.PC++;
            return this.executeAnd(this.H());
        }
        else if (op === 0xA5) {
            // AND L
            this.PC++;
            return this.executeAnd(this.L());
        }
        else if (op === 0x28) {
            // JR Z, r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2;
            if (this.getFlag(exports.ZERO_FLAG)) {
                // jumped
                this.PC += offset;
                return 12;
            }
            else {
                // not jumped
                return 8;
            }
        }
        else if (op === 0xC0) {
            // RET NZ
            if (!this.getFlag(exports.ZERO_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            }
            else {
                this.PC++;
                return 8;
            }
        }
        else if (op === 0xC8) {
            // 'RET Z'
            if (this.getFlag(exports.ZERO_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            }
            else {
                this.PC++;
                return 8;
            }
        }
        else if (op === 0xD0) {
            // 'RET NC'
            if (!this.getFlag(exports.CARRY_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            }
            else {
                this.PC++;
                return 8;
            }
        }
        else if (op === 0xD8) {
            // 'RET C'
            if (this.getFlag(exports.CARRY_FLAG)) {
                const lsb = this.stackPop();
                const msb = this.stackPop();
                const addr = (msb << 8) | lsb;
                this.PC = addr;
                return 20;
            }
            else {
                this.PC++;
                return 8;
            }
        }
        else if (op === 0xFA) {
            // 'LD A, (a16)';
            const value = this.readTwoByteValue(this.PC + 1);
            this.A = this.bus.readByte(value);
            this.PC += 3;
            return 16;
        }
        else if (op === 0x3D) {
            // DEC A
            const result = wrappingByteSub(this.A, 1);
            this.updateSubHalfCarryFlag(this.A, 1);
            this.A = result[0];
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.A);
            this.PC++;
            return 4;
        }
        else if (op === 0x2D) {
            // DEC L
            this.decrementL();
            this.updateSubHalfCarryFlag(this.L(), 1);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateZeroFlag(this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x11) {
            // LD DE, d16
            const lsb = this.bus.readByte(this.PC + 1);
            const msb = this.bus.readByte(this.PC + 2);
            this.D = msb;
            this.E = lsb;
            this.PC += 3;
            return 12;
        }
        else if (op === 0x7E) {
            // LD A, (HL)
            const value = this.bus.readByte(this.HL);
            this.A = value;
            this.PC++;
            return 8;
        }
        else if (op === 0x6E) {
            // LD L, (HL)
            const value = this.bus.readByte(this.HL);
            this.HL = (this.H() << 8) | value;
            this.PC++;
            return 8;
        }
        else if (op === 0x5E) {
            // LD E, (HL)
            const value = this.bus.readByte(this.HL);
            this.E = value;
            this.PC++;
            return 8;
        }
        else if (op === 0x4E) {
            // LD C, (HL)
            const value = this.bus.readByte(this.HL);
            this.C = value;
            this.PC++;
            return 8;
        }
        else if (op === 0xB7) {
            // OR A
            this.A = this.A | this.A;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xC1) {
            // POP BC
            this.C = this.stackPop();
            this.B = this.stackPop();
            this.PC++;
            return 12;
        }
        else if (op === 0xD1) {
            // POP DE
            this.E = this.stackPop();
            this.D = this.stackPop();
            this.PC++;
            return 12;
        }
        else if (op === 0xE1) {
            // POP HL
            const l = this.stackPop();
            const h = this.stackPop();
            this.HL = (h << 8) | l;
            this.PC++;
            return 12;
        }
        else if (op === 0xF1) {
            // POP AF
            const popped = this.stackPop();
            this.Flags = this.loadFlags(popped);
            this.A = this.stackPop();
            this.PC++;
            return 12;
        }
        else if (op === 0x3C) {
            // INC A
            const [result,] = wrappingByteAdd(this.A, 1);
            this.updateHalfCarryFlag(this.A, 1);
            this.A = result;
            this.updateZeroFlag(this.A);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x2C) {
            // INC L
            const [result,] = wrappingByteAdd(this.L(), 1);
            this.updateHalfCarryFlag(this.L(), 1);
            this.HL = (this.HL & 0xFF00) | result;
            this.updateZeroFlag(result);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x1C) {
            // INC E
            const [result,] = wrappingByteAdd(this.E, 1);
            this.updateHalfCarryFlag(this.E, 1);
            this.E = result;
            this.updateZeroFlag(this.E);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x34) {
            // INC (HL)
            const value = this.bus.readByte(this.HL);
            const [result,] = wrappingTwoByteAdd(value, 1);
            this.updateHalfCarryFlag(value, 1);
            this.bus.writeByte(this.HL, result);
            this.updateZeroFlag(result);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 12;
        }
        else if (op === 0x2F) {
            // CPL   [complement A]
            this.A = bitNegation(this.A);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.setFlag(exports.HALF_CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0xE6) {
            // AND A, d8
            const value = this.bus.readByte(this.PC + 1);
            const originalA = this.A;
            this.A = originalA & value;
            this.updateZeroFlag(this.A);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.updateSubHalfCarryFlag(this.A, originalA);
            this.clearFlag(exports.CARRY_FLAG); // TODO: ONLY SET WHEN LAST BIT OF VALUE IS 0
            this.PC += 2;
            return 8;
        }
        else if (op === 0x47) {
            // LD B, A
            this.B = this.A;
            this.PC++;
            return 4;
        }
        else if (op === 0x46) {
            // 'LD B, (HL)';
            this.B = this.bus.readByte(this.HL);
            this.PC++;
            return 4;
        }
        else if (op === 0x45) {
            // 'LD B, L';
            this.B = this.L();
            this.PC++;
            return 4;
        }
        else if (op === 0x44) {
            // 'LD B, H';
            this.B = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x43) {
            // 'LD B, E';
            this.B = this.E;
            this.PC++;
            return 4;
        }
        else if (op === 0x42) {
            // 'LD B, D';
            this.B = this.D;
            this.PC++;
            return 4;
        }
        else if (op === 0x41) {
            // 'LD B, C';
            this.B = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0x40) {
            // 'LD B, B';
            this.B = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0x4F) {
            // 'LD C, A';
            this.C = this.A;
            this.PC++;
            return 4;
        }
        else if (op === 0x4D) {
            // 'LD C, L';
            this.C = this.L();
            this.PC++;
            return 4;
        }
        else if (op === 0x4C) {
            // 'LD C, H';
            this.C = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x4B) {
            // 'LD C, E';
            this.C = this.E;
            this.PC++;
            return 4;
        }
        else if (op === 0x4A) {
            // 'LD C, D';
            this.C = this.D;
            this.PC++;
            return 4;
        }
        else if (op === 0x49) {
            // 'LD C, C';
            this.C = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0x48) {
            // 'LD C, B';
            this.C = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0xA9) {
            // XOR C
            this.A = this.A ^ this.C;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xEF) {
            // 'RST 28h';
            // Push present address onto stack.
            // Jump to address 0x0028
            const returnAddr = this.PC + 1;
            const [higherByte, lowerByte] = this.split16BitValueIntoTwoBytes(returnAddr);
            this.stackPush(higherByte);
            this.stackPush(lowerByte);
            this.PC = 0x28;
            return 16;
        }
        else if (op === 0x87) {
            // ADD A, A;
            const result = wrappingByteAdd(this.A, this.A);
            this.updateHalfCarryFlag(this.A, this.A);
            this.A = result[0];
            this.clearFlag(exports.SUBTRACTION_FLAG);
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x5F) {
            // LD E, A
            this.E = this.A;
            this.PC++;
            return 4;
        }
        else if (op === 0x5D) {
            // LD E, L
            this.E = this.L();
            this.PC++;
            return 4;
        }
        else if (op === 0x5C) {
            // LD E, H
            this.E = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x5B) {
            // LD E, E
            this.E = this.E;
            this.PC++;
            return 4;
        }
        else if (op === 0x5A) {
            // LD E, D
            this.E = this.D;
            this.PC++;
            return 4;
        }
        else if (op === 0x59) {
            // LD E, C
            this.E = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0x58) {
            // LD E, B
            this.E = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0x23) {
            // 'INC HL';
            const [result,] = wrappingTwoByteAdd(this.HL, 1);
            this.HL = result;
            this.PC++;
            return 8;
        }
        else if (op === 0x24) {
            // 'INC H';
            console.log('INC H not implemented yet');
            this.PC++;
            return 4;
        }
        else if (op === 0x56) {
            // LD D, (HL)
            this.D = this.bus.readByte(this.HL);
            this.PC++;
            return 8;
        }
        else if (op === 0x57) {
            // LD D, A
            this.D = this.A;
            this.PC++;
            return 4;
        }
        else if (op === 0x55) {
            // LD D, L
            this.D = this.L();
            this.PC++;
            return 4;
        }
        else if (op === 0x54) {
            // LD D, H
            this.D = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x53) {
            // LD D, E
            this.D = this.E;
            this.PC++;
            return 4;
        }
        else if (op === 0x52) {
            // LD D, D
            this.D = this.D;
            this.PC++;
            return 4;
        }
        else if (op === 0x51) {
            // LD D, C
            this.D = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0x50) {
            // LD D, B
            this.D = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0xE9) {
            // 'JP (HL)';
            this.PC = this.HL;
            return 4;
        }
        else if (op === 0x13) {
            // INC DE
            this.incrementDE();
            this.PC++;
            return 8;
        }
        else if (op === 0x1A) {
            // LD A, (DE)
            this.A = this.bus.readByte(this.DE());
            this.PC++;
            return 8;
        }
        else if (op === 0x22) {
            // LD (HL+),A
            this.bus.writeByte(this.HL, this.A);
            this.HL++;
            this.PC++;
            return 8;
        }
        else if (op === 0xCA) {
            // JP Z, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (this.getFlag(exports.ZERO_FLAG)) {
                this.PC = addr;
                return 16;
            }
            else {
                this.PC += 3;
                return 12;
            }
        }
        else if (op === 0x35) {
            // DEC (HL)
            const value = this.bus.readByte(this.HL);
            const [result,] = wrappingTwoByteSub(value, 1);
            this.bus.writeByte(this.HL, result[0]);
            this.updateSubHalfCarryFlag(value, 1);
            this.updateZeroFlag(result[0]);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.PC++;
            return 12;
        }
        else if (op === 0x09) {
            // ADD HL,BC
            const [result,] = wrappingTwoByteSub(this.HL, this.BC());
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.updateHalfCarryFlag(this.HL, this.BC());
            this.HL = result[0];
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return 8;
        }
        else if (op === 0x69) {
            // LD L, C
            this.updateL(this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x60) {
            // LD H, B
            this.updateH(this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x0A) {
            // 'LD A, (BC)';
            this.A = this.bus.readByte(this.BC());
            this.PC++;
            return 8;
        }
        else if (op === 0x03) {
            // INC BC
            this.incrementBC();
            this.PC++;
            return 8;
        }
        else if (op === 0x80) {
            // 'ADD A, B';
            this.A = this.addOneByte(this.A, this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x81) {
            // 'ADD A, C';
            this.A = this.addOneByte(this.A, this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x82) {
            // 'ADD A, D';
            this.A = this.addOneByte(this.A, this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x83) {
            // 'ADD A, E';
            this.A = this.addOneByte(this.A, this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x84) {
            // 'ADD A, H';
            this.A = this.addOneByte(this.A, this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x85) {
            // 'ADD A, L';
            this.A = this.addOneByte(this.A, this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x86) {
            // 'ADD A, (HL)';
            this.A = this.addOneByte(this.A, this.bus.readByte(this.HL));
            this.PC++;
            return 8;
        }
        else if (op === 0x88) {
            // 'ADC A, B';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.B, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x89) {
            // 'ADC A, C';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.C, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8A) {
            // 'ADC A, D';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.D, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8B) {
            // 'ADC A, E';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.E, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8C) {
            // 'ADC A, H';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.H(), carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8D) {
            // 'ADC A, L';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.L(), carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8E) {
            // 'ADC A, (HL)';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.bus.readByte(this.HL), carryValue);
            this.PC++;
            return 8;
        }
        else if (op === 0x8F) {
            // 'ADC A, A';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.A, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x6F) {
            // LD L, A
            this.updateL(this.A);
            this.PC++;
            return 4;
        }
        else if (op === 0x6D) {
            // 'LD L, L';
            this.updateL(this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x6C) {
            // 'LD L, H';
            this.updateL(this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x6B) {
            // 'LD L, E';
            this.updateL(this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x6A) {
            // 'LD L, D';
            this.updateL(this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x68) {
            // 'LD L, B';
            this.updateL(this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x61) {
            // 'LD H, C';
            this.updateH(this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x62) {
            // 'LD H, D';
            this.updateH(this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x63) {
            // 'LD H, E';
            this.updateH(this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x64) {
            // 'LD H, H';
            this.updateH(this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x65) {
            // 'LD H, L';
            this.updateH(this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x66) {
            // 'LD H, (HL)';
            this.updateH(this.bus.readByte(this.HL));
            this.PC++;
            return 4;
        }
        else if (op === 0x67) {
            // 'LD H, A';
            this.updateH(this.A);
            this.PC++;
            return 4;
        }
        else if (op === 0xC2) {
            // JP NZ, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (!this.getFlag(exports.ZERO_FLAG)) {
                this.PC = addr;
                return 16;
            }
            else {
                this.PC += 3;
                return 12;
            }
        }
        else if (op === 0x7A) {
            // 'LD A, D';
            this.A = this.D;
            this.PC++;
            return 4;
        }
        else if (op === 0x7D) {
            // 'LD A, L';
            this.A = this.L();
            this.PC++;
            return 4;
        }
        else if (op === 0x70) {
            // 'LD (HL), B';
            this.bus.writeByte(this.HL, this.B);
            this.PC++;
            return 8;
        }
        else if (op === 0x71) {
            // 'LD (HL), C';
            this.bus.writeByte(this.HL, this.C);
            this.PC++;
            return 8;
        }
        else if (op === 0xC6) {
            // ADD A, d8
            const value = this.bus.readByte(this.PC + 1);
            this.A = this.addOneByte(this.A, value);
            this.PC += 2;
            return 8;
        }
        else if (op === 0xEE) {
            // XOR d8
            const value = this.bus.readByte(this.PC + 1);
            this.A = this.A ^ value;
            this.updateZeroFlagAndClearOthers();
            this.PC += 2;
            return 8;
        }
        else if (op === 0xC4) {
            // CALL NZ, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (!this.Flags.zeroFlag) {
                this.PC = addr;
                return 24;
            }
            this.PC += 3;
            return 12;
        }
        else if (op === 0xD6) {
            // SUB d8
            const value = this.bus.readByte(this.PC + 1);
            this.A = this.subOneByte(this.A, value);
            this.PC += 2;
            return 8;
        }
        else if (op === 0xAE) {
            // XOR (HL)
            const value = this.bus.readByte(this.HL);
            this.A ^= value;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 8;
        }
        else if (op === 0x26) {
            // `LD H, d8`;
            const value = this.bus.readByte(this.PC + 1);
            this.updateH(value);
            this.PC += 2;
            return 8;
        }
        else if (op === 0x38) {
            const value = this.bus.readByte(this.PC + 1);
            const offset = makeSigned(value, 1);
            this.PC += 2; // move to next instruction then add offset
            //const addr = this.PC + offset;
            this.PC += offset;
        }
        else if (op === 0xCB) {
            let nextInstrByte = this.bus.readByte(this.PC + 1);
            switch (nextInstrByte) {
                case 0x37:
                    // SWAP A
                    this.swapNibblesOf(this.A);
                    this.PC += 2;
                    return 8;
                case 0x30:
                    // SWAP B
                    this.swapNibblesOf(this.B);
                    this.PC += 2;
                    return 8;
                case 0x31:
                    // SWAP C
                    this.swapNibblesOf(this.C);
                    this.PC += 2;
                    return 8;
                case 0x32:
                    // SWAP D
                    this.swapNibblesOf(this.D);
                    this.PC += 2;
                    return 8;
                case 0x33:
                    // SWAP E
                    this.swapNibblesOf(this.E);
                    this.PC += 2;
                    return 8;
                case 0x34:
                    // SWAP H
                    const swappedH = this.swapNibblesOf(this.H());
                    this.HL = (swappedH << 8) | this.L();
                    this.PC += 2;
                    return 8;
                case 0x35:
                    // SWAP L
                    const swappedL = this.swapNibblesOf(this.L());
                    this.HL = (this.H() << 8) | swappedL;
                    this.PC += 2;
                    return 8;
                case 0x36:
                    // SWAP (HL)
                    const swapValue = this.bus.readByte(this.HL);
                    const swapped = this.swapNibblesOf(swapValue);
                    this.bus.writeByte(this.HL, swapped);
                    this.PC += 2;
                    return 16;
                case 0x87:
                    // 'RES 0, A'
                    // Reset bit u3 in register r8 to 0. Bit 0 is the rightmost one, bit 7 the leftmost one.
                    this.A = this.clearBit(this.A, 0);
                    this.PC += 2;
                    return 8;
                case 0x86:
                    // 'RES 0, (HL)'
                    const hlValue = this.clearBit(this.bus.readByte(this.HL), 0);
                    this.bus.writeByte(this.HL, hlValue);
                    this.PC += 2;
                    return 16;
                case 0x27:
                    // SLA A
                    // Shift n left into Carry. LSB of n set to 0
                    if ((this.A & 0x80) === 0x80) {
                        this.setFlag(exports.HALF_CARRY_FLAG);
                    }
                    else {
                        this.clearFlag(exports.HALF_CARRY_FLAG);
                    }
                    this.A = this.A << 1;
                    this.clearFlag(exports.SUBTRACTION_FLAG);
                    this.clearFlag(exports.CARRY_FLAG);
                    this.updateZeroFlag(this.A);
                    this.PC += 2;
                    return 8;
                case 0x78:
                    // BIT 7, B
                    this.updateZeroFlagWithBit(this.B, 7);
                    this.PC += 2;
                    return 8;
                case 0x79:
                    // BIT 7, C
                    this.updateZeroFlagWithBit(this.C, 7);
                    this.PC += 2;
                    return 8;
                case 0x7A:
                    // BIT 7, D
                    this.updateZeroFlagWithBit(this.D, 7);
                    this.PC += 2;
                    return 8;
                case 0x7B:
                    // BIT 7, E
                    this.updateZeroFlagWithBit(this.E, 7);
                    this.PC += 2;
                    return 8;
                case 0x7C:
                    // BIT 7, H
                    this.updateZeroFlagWithBit(this.H(), 7);
                    this.PC += 2;
                    return 8;
                case 0x7D:
                    // BIT 7, L
                    this.updateZeroFlagWithBit(this.L(), 7);
                    this.PC += 2;
                    return 8;
                case 0x7E:
                    // BIT 7, (HL)
                    this.updateZeroFlagWithBit(this.bus.readByte(this.HL), 7);
                    this.PC += 2;
                    return 16;
                case 0x7F:
                    // Updates Z, is zero flag
                    // BIT 7, A
                    this.updateZeroFlagWithBit(this.A, 7);
                    this.PC += 2;
                    return 8;
                case 0x50:
                    // 'BIT 2, B';
                    this.updateZeroFlagWithBit(this.B, 2);
                    this.PC += 2;
                    return 8;
                case 0x51:
                    // 'BIT 2, C';
                    this.updateZeroFlagWithBit(this.C, 2);
                    this.PC += 2;
                    return 8;
                case 0x52:
                    // 'BIT 2, D';
                    this.updateZeroFlagWithBit(this.D, 2);
                    this.PC += 2;
                    return 8;
                case 0x53:
                    // 'BIT 2, E';
                    this.updateZeroFlagWithBit(this.E, 2);
                    this.PC += 2;
                    return 8;
                case 0x54:
                    // 'BIT 2, H';
                    this.updateZeroFlagWithBit(this.H(), 2);
                    this.PC += 2;
                    return 8;
                case 0x55:
                    // 'BIT 2, L';
                    this.updateZeroFlagWithBit(this.L(), 2);
                    this.PC += 2;
                    return 8;
                case 0x56:
                    // 'BIT 2, (HL)';
                    this.updateZeroFlagWithBit(this.bus.readByte(this.HL), 2);
                    this.PC += 2;
                    return 8;
                case 0x57:
                    // 'BIT 2, A';
                    this.updateZeroFlagWithBit(this.A, 2);
                    this.PC += 2;
                    return 8;
                case 0x38:
                    // SRL B
                    // Shift n right into Carry. MSB set to 0.
                    let shouldSetCarryFlag = false;
                    if ((this.B & 0x01) === 0x01) {
                        shouldSetCarryFlag = true;
                    }
                    this.B = this.B >> 1;
                    this.clearFlag(exports.CARRY_FLAG);
                    if (shouldSetCarryFlag) {
                        this.setFlag(exports.CARRY_FLAG);
                    }
                    this.PC += 2;
                    return 8;
                case 0x19:
                    // 'RR C';
                    // Rotate n right through Carry flag.
                    this.C = this.rotateRightThroughCarry(this.C);
                    this.PC += 2;
                    return 8;
                case 0x18:
                    // 'RR B';
                    this.B = this.rotateRightThroughCarry(this.B);
                    this.PC += 2;
                    return 8;
                case 0x1A:
                    // 'RR D';
                    this.D = this.rotateRightThroughCarry(this.D);
                    this.PC += 2;
                    return 8;
                case 0x1B:
                    // 'RR E';
                    this.E = this.rotateRightThroughCarry(this.E);
                    this.PC += 2;
                    return 8;
                case 0x1C:
                    // 'RR H';
                    this.updateH(this.rotateRightThroughCarry(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x1D:
                    // 'RR L';
                    this.updateL(this.rotateRightThroughCarry(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x1E:
                    // 'RR (HL)';
                    const value = this.bus.readByte(this.HL);
                    this.bus.writeByte(this.HL, this.rotateRightThroughCarry(value));
                    this.PC += 2;
                    return 16;
                case 0x1F:
                    // 'RR A';
                    this.A = this.rotateRightThroughCarry(this.A);
                    this.PC += 2;
                    return 8;
                default:
                    console.log(`Error: encountered an unsupported opcode of ${utils_1.displayAsHex(op)} ${utils_1.displayAsHex(nextInstrByte)} at address ${utils_1.displayAsHex(this.PC)}`);
                    return 0;
            }
        }
        console.log(`Error: encountered an unsupported opcode of ${utils_1.displayAsHex(op)} at address ${utils_1.displayAsHex(this.PC)}`);
        return 0;
    }
    rotateRightThroughCarry(value) {
        // 1001 1010
        // 0011 010[0] | [1]
        const currCarry = this.Flags.carryFlag ? 0x80 : 0x00;
        const msb = (value & 0x80) === 0x80 ? 0x1 : 0x0;
        this.Flags.carryFlag = msb === 0x1 ? true : false;
        const updated = (value >>> 1) | currCarry;
        this.Flags.zeroFlag = updated === 0x00 ? true : false;
        return updated;
    }
    updateZeroFlagWithBit(value, bit) {
        const val = this.getBit(value, bit);
        val === 1 ? this.setFlag(exports.ZERO_FLAG) : this.clearFlag(exports.ZERO_FLAG);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.setFlag(exports.HALF_CARRY_FLAG);
    }
    getBit(value, bit) {
        const mask = 0x1 << bit;
        return (mask & value) >> bit;
    }
    setBit(value, bit) {
        const mask = 0x1 << bit;
        return value | mask;
    }
    clearBit(value, bit) {
        const mask = 0x1 << bit;
        return value & ~mask;
    }
    executeAnd(operand) {
        this.A = this.A & operand;
        this.updateZeroFlag(this.A);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.setFlag(exports.HALF_CARRY_FLAG);
        this.clearFlag(exports.CARRY_FLAG);
        return 4; // consumes 4 cycles
    }
    // @return number => the resulting value after its nibbles are swapped
    swapNibblesOf(value) {
        // swap upper and lower nibbles of A
        const upper = (value & 0xF0) >> 4;
        const lower = value & 0x0F;
        value = (lower << 4) | upper;
        this.updateZeroFlag(value);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        this.clearFlag(exports.CARRY_FLAG);
        return value;
    }
    // the result was stored in register A
    updateZeroFlagAndClearOthers() {
        this.updateZeroFlag(this.A);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        this.clearFlag(exports.CARRY_FLAG);
    }
    // Useful for when pushing 16-bit values on to a stack
    // @param value -> a 16-bit value that is split into two bytes
    // @return twoBytes number[] -> splits single 16 bit value into an array of two bytes.
    split16BitValueIntoTwoBytes(value) {
        const lowerByte = value & 0x00FF;
        const higherByte = value >> 8;
        return [higherByte, lowerByte];
    }
    stackPush(value) {
        this.SP--;
        this.bus.writeByte(this.SP, value);
    }
    stackPop() {
        const value = this.bus.readByte(this.SP);
        this.SP++;
        return value;
    }
    updateZeroFlag(value) {
        if (value === 0x00) {
            // set the zero flag
            this.setFlag(exports.ZERO_FLAG);
        }
        else {
            this.clearFlag(exports.ZERO_FLAG);
        }
    }
    updateSubHalfCarryFlag(a, b) {
        if ((((a & 0xF) - (b & 0xF)) & 0x10) === 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        else {
            this.clearFlag(exports.HALF_CARRY_FLAG);
        }
    }
    // for addition operations
    updateHalfCarryFlag(a, b) {
        // (((a & 0xf) + (b & 0xf)) & 0x10) == 0x10
        if ((((a & 0xF) + (b & 0xF)) & 0x10) === 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        else {
            this.clearFlag(exports.HALF_CARRY_FLAG);
        }
    }
}
exports.CPU = CPU;
const ROM_BANK_0_START_ADDR = 0x0000;
const ROM_BANK_0_END_ADDR = 0x3FFF;
class Gameboy {
    constructor(inDebugMode = false, performance = null, readlineSync = null) {
        this.memory = new Memory();
        this.ppu = new ppu_1.PPU();
        this.cpu = new CPU();
        this.bus = new MemoryBus(this.memory, this.ppu, this.cpu);
        this.cpu.setMemoryBus(this.bus);
        this.ppu.setMemoryBus(this.bus);
        this.inDebugMode = inDebugMode && readlineSync;
        if (!readlineSync && this.inDebugMode) {
            console.log(`[WARN] Debug mode was requested but required library readlineSync was not provided.`);
        }
        this.debugger = new debugger_console_1.DebugConsole(this, readlineSync);
        this.totalCpuInstructionsExecuted = 0;
        this.performance = performance || window.performance;
    }
    powerOn() {
        if (!this.cartridge.isLoaded) {
            throw new Error('Error powering on the GameBoy due to the cartridge not being loaded yet.');
        }
        if (!this.cartridge.mbc) {
            throw new Error('Error: MBC banking is not yet supported and the rom does require MBC banking');
        }
        if (this.inDebugMode) {
            console.log("The gameboy has powered on in debug mode");
        }
        // initialize the CPU
        this.cpu.initAfterRomLoaded();
    }
    processInterrupts() {
        return this.cpu.processInterrupts();
    }
    // @return boolean => should we continue executing
    async executeNextTick() {
        const prevProgramCounter = this.cpu.PC;
        const disassembled = this.cpu.disassembleNextInstruction() || "<unknown>";
        if (this.inDebugMode && this.debugger.shouldShowDebugger()) {
            // suspend execution until a key is pressed
            console.log(`* [${utils_1.displayAsHex(prevProgramCounter)}]: ${disassembled}`);
            this.debugger.showConsole();
        }
        //console.log(`[${displayAsHex(prevProgramCounter)}]: ${disassembled}`);
        // ExecuteNextInstruction will modify the PC register appropriately
        const prevSP = this.cpu.SP;
        const prevPC = this.cpu.PC;
        const cycles = this.cpu.executeInstruction();
        if (cycles === 0) {
            console.log(`Executed total of ${this.totalCpuInstructionsExecuted} instructions`);
            return false;
        }
        this.totalCpuInstructionsExecuted += cycles;
        if (prevProgramCounter === this.cpu.PC) {
            console.log(`Error: cpu.PC was not changed after last executeInstruction() call. Infinite loop`);
            return false;
        }
        // was last instruction a call? if so inform the debugger
        if (this.cpu.lastExecutedOpCode === 0xCD) {
            this.debugger.pushCallAddress(this.cpu.PC);
        }
        else if (this.cpu.lastExecutedOpCode === 0xD9 || this.cpu.lastExecutedOpCode === 0xC9) {
            this.debugger.popCallAddress();
        }
        else if ((this.cpu.lastExecutedOpCode === 0xC0 || this.cpu.lastExecutedOpCode === 0xC8) && (this.cpu.PC - prevProgramCounter) !== 1) {
            // conditional returns
            this.debugger.popCallAddress();
        }
        // process interrupts
        if (this.processInterrupts()) {
            // interrupt was invoked. Do nothing else and start executing the interrupt immediately
            this.debugger.pushCallAddress(this.cpu.PC);
            return true;
        }
        this.ppu.step(cycles);
        // check if V Blank Interrupt was requested
        if (this.processInterrupts()) {
            // interrupt was invoked. Do nothing else and start executing the interrupt immediately
            // TODO: Disable interrupts globally
            this.debugger.pushCallAddress(this.cpu.PC);
            return true;
        }
        if (this.cpu.shouldEnableInterrupts) {
            this.cpu.enableInterrupts();
        }
        return true;
    }
    async executeRom(updateScreenCallback) {
        let keepRunning = true;
        this.totalCpuInstructionsExecuted = 0;
        const updateFreqInMs = 1000 / 60;
        let lastUpdateTime = this.performance.now(); // new Date();
        console.log(lastUpdateTime);
        while (keepRunning) {
            keepRunning = await this.executeNextTick();
            const currTime = this.performance.now();
            if ((currTime - lastUpdateTime) > updateFreqInMs) {
                lastUpdateTime = currTime;
                updateScreenCallback(this.ppu.getScreenData());
            }
        }
        console.log('CPU stopped executing. Most likely due to executing instruction error');
    }
    // when cart is loaded its code is memory mapped to
    // addr 0000-7FFFh of the gameboy's internal ram.
    // addresses 0000-3FFF is ROM Bank 00 (read-only)
    // which contains the Interrupt Table, and Header Information
    async loadCartridge(cart) {
        this.cartridge = cart;
        await this.cartridge.load();
        this.bus.cartridge = this.cartridge;
        // load bank 0 into Gameboy's ram (0x0000 - 0x3FFF)(16K bytes)
        this.loadRomDataIntoMemory(0x0000, 0x0000, ROM_BANK_END_ADDR);
    }
    loadRomDataIntoMemory(startRamAddr, startRomAddr, bankSizeBytes) {
        const endRamAddr = startRamAddr + bankSizeBytes;
        for (let memAddr = startRamAddr, romAddr = startRomAddr; memAddr <= endRamAddr; memAddr++, romAddr++) {
            this.memory.ram[memAddr] = this.cartridge.romBytes[romAddr];
        }
    }
}
exports.Gameboy = Gameboy;
const HEADER_TITLE_START_ADDR = 0x0134;
const HEADER_TITLE_END_ADDR = 0x0143;
class Cartridge {
    constructor(name, romBytes) {
        this.romName = name;
        this.isLoaded = false;
        if (romBytes) {
            this.romBytes = romBytes;
            this.initMBC();
            this.isLoaded = true;
        }
        else {
            this.isLoaded = false;
        }
    }
    async load() {
        // if rom wasn't loaded yet
        if (!this.isLoaded) {
            this.romBytes = rom_loader_1.loadRomFromFileSystem(this.romName);
            this.initMBC();
            this.isLoaded = true;
        }
    }
    initMBC() {
        const romHeader = this.getRomHeaderInfo();
        if (romHeader.cartridgeType === 0x00) { // MBC0
            this.mbc = new mbc_1.MBC0(this.romBytes, this.getROMSize(romHeader.romSize));
        }
        else if (romHeader.cartridgeType === 0x01) { // MBC1
            this.mbc = new mbc_1.MBC1(this.romBytes, this.getROMSize(romHeader.romSize));
        }
        else {
            // MBC not supported
            console.log(`ERROR: MBC of type ${romHeader.cartridgeType} is not currently supported`);
            this.mbc = null;
        }
    }
    getROMSize(romSizeHeaderValue) {
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
    getRomHeaderInfo() {
        const titleBytes = this.romBytes.slice(HEADER_TITLE_START_ADDR, HEADER_TITLE_END_ADDR + 1);
        return {
            romTitle: utils_1.uInt8ArrayToUtf8(titleBytes),
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
    getLiscenseCode() {
        const oldLiscenseCode = this.romBytes[0x014B];
        if (oldLiscenseCode === 0x33) {
            // value of 0x33 signifies that the liscense code is found in the newLiscenseCode byte
            return (this.romBytes[0x0144] << 8) & this.romBytes[0x0145];
        }
        return oldLiscenseCode;
    }
}
exports.Cartridge = Cartridge;
