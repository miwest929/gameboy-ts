"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cartridge = exports.Gameboy = exports.CPU = exports.CARRY_FLAG = exports.HALF_CARRY_FLAG = exports.SUBTRACTION_FLAG = exports.ZERO_FLAG = exports.MemoryBus = exports.InterruptRequestRegister = exports.InterruptAddress = exports.Interrupt = exports.InterruptEnabledRegister = void 0;
const rom_loader_1 = require("./rom_loader");
const utils_1 = require("./utils");
const ppu_1 = require("./ppu");
const mbc_1 = require("./mbc");
const debugger_console_1 = require("./debugger_console");
const disassembler_1 = require("./disassembler");
const ADDRESS_TRACING_MODE = true;
const LOG_SERIAL_IO_BYTES = true;
/*
TODO:
  In order to hookthe backend (this repo) with its frontend (gameboy-ts-web) this file needs to be
  loadable in a browser context. But "perf_hooks" library only exists in Node. In the browser,
  performance is referenced with 'window.performance'. We need to conditionally perform this import.
  Haven't figured out how to properly do that.
*/
//import { performance } from 'perf_hooks';
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
exports.InterruptEnabledRegister = InterruptEnabledRegister;
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
})(InterruptAddress = exports.InterruptAddress || (exports.InterruptAddress = {}));
const IF_ADDR = 0xFF0F;
class InterruptRequestRegister {
    constructor() {
        this.RawValue = 0x00;
    }
    ClearRequest(interruptBit) {
        this.RawValue &= utils_1.bitNegation(interruptBit);
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
exports.InterruptRequestRegister = InterruptRequestRegister;
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
            //this.performDMAOAMTransfer(value);
        }
        else if (addr >= 0xff40 && addr <= 0xff4a) { //PPU Special Registers
            this.ppu.writeSpecialRegister(addr, value);
        }
        else if (addr === 0xFF01) {
            if (LOG_SERIAL_IO_BYTES) {
                console.log(`OUT: ${String.fromCharCode(value)} (${utils_1.displayAsHex(value)}), PC = ${utils_1.displayAsHex(this.cpu.PC)}`);
            }
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
            return this.memory.read(addr);
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
        this.totalCpuInstructionsExecuted = 0;
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
    incrementHL() {
        const result = wrappingTwoByteAdd(this.HL, 1);
        this.HL = result[0];
    }
    decrementHL() {
        const result = wrappingTwoByteSub(this.HL, 1);
        this.HL = result[0];
    }
    H() {
        return (this.HL & 0xFF00) >>> 8;
    }
    L() {
        return this.HL & 0x00FF;
    }
    incrementH() {
        const result = wrappingByteAdd(this.H(), 1);
        //this.updateHalfCarryFlag(this.H(), 1);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        if (((result[0] ^ this.H() ^ 1) & 0x10) == 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        this.updateH(result[0]);
        this.updateZeroFlag(this.H());
        this.clearFlag(exports.SUBTRACTION_FLAG);
    }
    incrementL() {
        const result = wrappingByteAdd(this.L(), 1);
        //this.updateHalfCarryFlag(this.L(), 1);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        if (((result[0] ^ this.L() ^ 1) & 0x10) == 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        this.updateL(result[0]);
        this.updateZeroFlag(this.L());
        this.clearFlag(exports.SUBTRACTION_FLAG);
    }
    updateH(value) {
        this.HL = (value << 8) | this.L();
    }
    updateL(value) {
        this.HL = (this.H() << 8) | value;
    }
    // decrement the H portion of HL register by 1
    decrementH() {
        const result = wrappingByteSub(this.H(), 1);
        this.updateSubHalfCarryFlag(this.H(), 1);
        this.updateH(result[0]);
        this.setFlag(exports.SUBTRACTION_FLAG);
        this.updateZeroFlag(this.H());
    }
    // decrement the L portion of HL register by 1
    decrementL() {
        const result = wrappingByteSub(this.L(), 1);
        this.updateSubHalfCarryFlag(this.L(), 1);
        this.updateL(result[0]);
        this.setFlag(exports.SUBTRACTION_FLAG);
        this.updateZeroFlag(this.L());
    }
    DE() {
        return (this.D << 8) | this.E;
    }
    decrementDE() {
        const result = wrappingTwoByteSub(this.DE(), 1);
        this.D = result[0] >>> 8;
        this.E = result[0] & 0x00FF;
    }
    incrementDE() {
        const result = wrappingTwoByteAdd(this.DE(), 1);
        this.D = result[0] >>> 8;
        this.E = result[0] & 0x00FF;
    }
    BC() {
        return (this.B << 8) | this.C;
    }
    decrementBC() {
        const result = wrappingTwoByteSub(this.BC(), 1);
        this.B = result[0] >>> 8;
        this.C = result[0] & 0x00FF;
    }
    incrementBC() {
        const result = wrappingTwoByteAdd(this.BC(), 1);
        this.B = result[0] >>> 8;
        this.C = result[0] & 0x00FF;
    }
    // Sets flags and returns the new value for the register
    incrementRegister(regValue) {
        const result = wrappingByteAdd(regValue, 1);
        //this.updateHalfCarryFlag(regValue, 1);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        if (((result[0] ^ regValue ^ 1) & 0x10) == 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.updateZeroFlag(result[0]);
        return result[0];
    }
    addOneByte(val1, val2, carryVal = 0) {
        const result = wrappingByteAdd(val1, val2 + carryVal);
        //this.updateHalfCarryFlag(val1, val2 + carryVal);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        if (((result[0] ^ val1 ^ (val2 + carryVal)) & 0x10) == 0x10) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        this.clearFlag(exports.SUBTRACTION_FLAG);
        result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
        this.updateZeroFlag(result[0]);
        return result[0];
    }
    subOneByte(val1, val2, carryVal = 0) {
        const result = wrappingByteSub(val1, val2 + carryVal);
        this.updateSubHalfCarryFlag(val1, val2 + carryVal);
        this.setFlag(exports.SUBTRACTION_FLAG);
        this.updateZeroFlag(result[0]);
        result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
        return result[0];
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
            subtractionFlag: (value & 0x40) === 0x40,
            zeroFlag: (value & 0x80) === 0x80,
            halfCarryFlag: (value & 0x20) === 0x20,
            carryFlag: (value & 0x10) === 0x10
        };
    }
    serializeFlags(flags) {
        let value = 0x00;
        if (flags.subtractionFlag) {
            value |= 0x40;
        }
        if (flags.zeroFlag) {
            value |= 0x80;
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
            this.pushAddressOnStack(returnAddr);
        }
        return wasInterruptInvoked;
    }
    getRegisterValueInvolved(op) {
        const valueMap = {
            0x0: this.B,
            0x1: this.C,
            0x2: this.D,
            0x3: this.E,
            0x4: this.H(),
            0x5: this.L(),
            0x6: this.bus.readByte(this.HL),
            0x7: this.A,
            0x8: this.B,
            0x9: this.C,
            0xA: this.D,
            0xB: this.E,
            0xC: this.H(),
            0xD: this.L(),
            0xE: this.bus.readByte(this.HL),
            0xF: this.A
        };
        return valueMap[op & 0x0F];
    }
    // READ-ONLY. Just reads the next instruction and disassemblies it as a string
    // This does not execute the instruction. Just returns it as string.
    // TODO: Now that we separated printing from executing instruction. We have shotgun surgory situation.
    //       Adding a new instruction requires modifying this method and the 'executeNextInstruction' method.
    //       The way around this is for each instruction to be its own class that includes execution AND disassembly.
    //       Since that would be a gigantic refactoring, hold off doing it until the emulator is working
    disassembleNextInstruction(op) {
        return disassembler_1.disassemble(op, this);
    }
    readTwoByteValue(baseAddr) {
        const lsb = this.bus.readByte(baseAddr);
        const msb = this.bus.readByte(baseAddr + 1);
        return (msb << 8) | lsb;
    }
    addToHLInstr(value) {
        const result = wrappingTwoByteAdd(this.HL, value);
        // TODO: REVIEW ALL CALLS to UPDATE HALF-CARRY FLAG. LOGIC IS DIFFERENT IF OPERATION
        //       WAS A SINGLE BYTE OR TWO BYTES.
        if (((result[0] ^ this.HL ^ value) & 0x1000) == 0x1000) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        else {
            this.clearFlag(exports.HALF_CARRY_FLAG);
        }
        this.HL = result[0];
        this.clearFlag(exports.SUBTRACTION_FLAG);
        result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
    }
    // Due to JMP, RET instructions this fn must modify the PC register itself.
    // The return value is the number of cycles the instruction took
    // Instruction cycle counts can be found here: http://www.pastraiser.com/cpu/gameboy/gameboy_opcodes.html
    // @return cyclesConsumed: number = The number of cycles the just executed instruction took
    executeInstruction() {
        if (this.shouldDisableInterrupts()) {
            this.disableInterrupts();
        }
        // TODO: Only increment if in debug mode
        this.totalCpuInstructionsExecuted++;
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
        else if (op === 0x21) {
            // LD HL, d16 (3 bytes, 12 cycles)
            this.HL = this.readTwoByteValue(this.PC + 1);
            this.PC += 3;
            return 12;
        }
        else if (op === 0x0E) {
            // LD C,d8
            this.C = this.bus.readByte(this.PC + 1);
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
            this.PC++;
            return 4;
        }
        else if (op === 0x20) {
            // branch if not zero
            // JR NotZero,r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = utils_1.makeSigned(value, 1);
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
            const newCarryValue = (this.A & 0x01) === 0x01;
            this.A = this.A >>> 1;
            if (this.getFlag(exports.CARRY_FLAG)) {
                this.A ^= 0x80;
            }
            this.clearFlag(exports.CARRY_FLAG);
            if (newCarryValue) {
                this.setFlag(exports.CARRY_FLAG);
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
        else if (op === 0x7B) {
            // LD A, E
            this.A = this.E;
            this.PC++;
            return 4;
            // } else if (op === 0xBF) {
            //     // compare A with A. Set flags as if they are equal
            //     // CP A
            //     this.setFlag(ZERO_FLAG);
            //     this.setFlag(SUBTRACTION_FLAG);
            //     this.clearFlag(HALF_CARRY_FLAG);
            //     this.clearFlag(CARRY_FLAG);
            //     this.PC++;
            //     return 4;
        }
        else if (op === 0x29) {
            // ADD HL, HL
            this.addToHLInstr(this.HL);
            this.PC++;
            return 8;
        }
        else if (op === 0x19) {
            // ADD HL,DE
            this.addToHLInstr(this.DE());
            this.PC++;
            return 8;
        }
        else if (op === 0x39) {
            // ADD HL, SP
            this.addToHLInstr(this.SP);
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
            this.A = this.rotateLeft(this.A);
            this.clearFlag(exports.ZERO_FLAG);
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
                // instruction is 3 bytes long
                this.PC += 3;
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
            const offset = utils_1.makeSigned(value, 1);
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
            // LD A, H
            this.A = this.H();
            this.PC++;
            return 4;
        }
        else if (op === 0x78) {
            // LD A, B
            this.A = this.B;
            this.PC++;
            return 4;
        }
        else if (op === 0x79) {
            // LD A, C
            this.A = this.C;
            this.PC++;
            return 4;
        }
        else if (op === 0xFF) {
            // Push present address onto stack. Jump to address $0000 + 56 (0x38).
            // RST 38H
            this.rstInstruction(0x38); // fn changes PC address
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
            this.incrementHL();
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
            this.pushAddressOnStack(this.PC + 3); // 3 because this instruction is 3 bytes long 
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
        else if (op === 0x02) {
            // LD (BC), A
            this.bus.writeByte(this.BC(), this.A);
            this.PC++;
            return 8;
        }
        else if (op === 0x02) {
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
            const offset = utils_1.makeSigned(value, 1);
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
            this.A = this.bus.readByte(this.HL);
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
            this.E = this.bus.readByte(this.HL);
            this.PC++;
            return 8;
        }
        else if (op === 0x4E) {
            // LD C, (HL)
            this.C = this.bus.readByte(this.HL);
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
        else if (op === 0x2F) {
            // CPL   [complement A]
            this.A = utils_1.bitNegation(this.A);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.setFlag(exports.HALF_CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0xE6) {
            // AND A, d8
            // Z 0 1 0
            const value = this.bus.readByte(this.PC + 1);
            this.A = this.A & value;
            this.updateZeroFlag(this.A);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.setFlag(exports.HALF_CARRY_FLAG);
            this.clearFlag(exports.CARRY_FLAG);
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
            return 8;
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
        else if (op === 0xEF) {
            // 'RST 28h';
            // Push present address onto stack.
            // Jump to address 0x0028
            this.pushAddressOnStack(this.PC + 1);
            this.PC = 0x28;
            return 16;
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
        else if (op === 0xE8) {
            // ADD SP, r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = utils_1.makeSigned(value, 1);
            const result = wrappingTwoByteAdd(this.SP, offset);
            //this.updateHalfCarryFlag(this.SP, offset);
            if (((result[0] ^ this.SP ^ offset) & 0x1000) == 0x1000) {
                this.setFlag(exports.HALF_CARRY_FLAG);
            }
            else {
                this.clearFlag(exports.HALF_CARRY_FLAG);
            }
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.clearFlag(exports.ZERO_FLAG);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.SP = result[0];
            this.PC += 2;
            return 16;
        }
        else if (op === 0xE9) {
            // 'JP (HL)';
            this.PC = this.HL;
            return 4;
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
            this.incrementHL();
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
            // ADD HL, BC
            this.addToHLInstr(this.BC());
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
            // LD A, (BC)';
            this.A = this.bus.readByte(this.BC());
            this.PC++;
            return 8;
        }
        else if (op === 0x80) {
            // ADD A, B';
            this.A = this.addOneByte(this.A, this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x81) {
            // ADD A, C';
            this.A = this.addOneByte(this.A, this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x82) {
            // ADD A, D';
            this.A = this.addOneByte(this.A, this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x83) {
            // ADD A, E';
            this.A = this.addOneByte(this.A, this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x84) {
            // ADD A, H';
            this.A = this.addOneByte(this.A, this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x85) {
            // ADD A, L';
            this.A = this.addOneByte(this.A, this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x86) {
            // ADD A, (HL)';
            this.A = this.addOneByte(this.A, this.bus.readByte(this.HL));
            this.PC++;
            return 8;
        }
        else if (op === 0x87) {
            // ADD A, A;
            this.A = this.addOneByte(this.A, this.A);
            this.PC++;
            return 4;
        }
        else if (op === 0x88) {
            // ADC A, B';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.B, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x89) {
            // ADC A, C';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.C, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8A) {
            // ADC A, D';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.D, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8B) {
            // ADC A, E';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.E, carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8C) {
            // ADC A, H';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.H(), carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8D) {
            // ADC A, L';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.L(), carryValue);
            this.PC++;
            return 4;
        }
        else if (op === 0x8E) {
            // ADC A, (HL)';
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
            this.addOneByte(this.A, this.bus.readByte(this.HL), carryValue);
            this.PC++;
            return 8;
        }
        else if (op === 0x8F) {
            // ADC A, A';
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
            return 8;
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
                this.pushAddressOnStack(this.PC + 3);
                this.PC = addr;
                return 24;
            }
            else {
                this.PC += 3;
                return 12;
            }
        }
        else if (op === 0xD6) {
            // SUB d8
            const value = this.bus.readByte(this.PC + 1);
            this.A = this.subOneByte(this.A, value);
            this.PC += 2;
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
            // JR C,r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = utils_1.makeSigned(value, 1);
            this.PC += 2; // move to next instruction then add offset
            if (this.getFlag(exports.CARRY_FLAG)) {
                this.PC += offset;
                return 12;
            }
            return 8;
        }
        else if (op === 0x30) {
            // JR NC, r8
            const value = this.bus.readByte(this.PC + 1);
            const offset = utils_1.makeSigned(value, 1);
            this.PC += 2;
            if (!this.getFlag(exports.CARRY_FLAG)) {
                this.PC += offset;
                return 12;
            }
            return 8;
        }
        else if (op === 0x33) {
            // INC SP
            this.SP = (this.SP + 1) & 0xFFFF;
            this.PC++;
            return 8;
        }
        else if (op === 0x3B) {
            // DEC SP
            this.SP = (this.SP - 1) & 0xFFFF;
            this.PC++;
            return 8;
        }
        else if (op === 0x73) {
            // LD (HL), E
            this.bus.writeByte(this.HL, this.E);
            this.PC++;
            return 8;
        }
        else if (op === 0x72) {
            // LD (HL), D
            this.bus.writeByte(this.HL, this.D);
            this.PC++;
            return 8;
        }
        else if (op === 0x71) {
            // LD (HL), C
            this.bus.writeByte(this.HL, this.C);
            this.PC++;
            return 8;
        }
        else if (op === 0x70) {
            // LD (HL), B
            this.bus.writeByte(this.HL, this.B);
            this.PC++;
            return 8;
        }
        else if (op === 0x77) {
            // LD (HL), A
            this.bus.writeByte(this.HL, this.A);
            this.PC++;
            return 8;
        }
        else if (op === 0x74 || op === 0x75) {
            // LD (HL), n
            const valueMap = {
                0x74: this.H(),
                0x75: this.L()
            };
            this.bus.writeByte(this.HL, valueMap[op]);
            this.PC += 1;
            return 8;
        }
        else if (op === 0x76) {
            // HALT
            // TODO: Halt CPU until interrupt occurs
            this.PC++;
            return 4;
        }
        else if (op === 0xF9) {
            // LD SP, HL
            this.SP = this.HL;
            this.PC++;
            return 8;
        }
        else if (op === 0xCE) {
            // ADC A, d8
            const value = this.bus.readByte(this.PC + 1);
            const carryValue = this.getFlag(exports.CARRY_FLAG) ? 0x01 : 0x00;
            this.A = this.addOneByte(this.A, value, carryValue);
            this.PC += 2;
            return 8;
        }
        else if (op >= 0xB0 && op <= 0xB7) {
            // OR n
            const valueMap = {
                0x0: this.B,
                0x1: this.C,
                0x2: this.D,
                0x3: this.E,
                0x4: this.H(),
                0x5: this.L(),
                0x6: this.bus.readByte(this.HL),
                0x7: this.A
            };
            this.A = this.A | valueMap[op & 0x0F];
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return op === 0xB6 ? 8 : 4;
        }
        else if (op === 0x1E) {
            // LD E, d8
            this.E = this.bus.readByte(this.PC + 1);
            this.PC += 2;
            return 8;
        }
        else if (op === 0xF6) {
            // OR d8
            const value = this.bus.readByte(this.PC + 1);
            this.executeOr(value);
            this.PC += 2;
            return 8;
        }
        else if (op === 0x03) {
            // INC BC
            this.incrementBC();
            this.PC++;
            return 8;
        }
        else if (op === 0x04) {
            // INC B
            this.B = this.incrementRegister(this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x0C) {
            // INC C
            this.C = this.incrementRegister(this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x14) {
            // INC D
            this.D = this.incrementRegister(this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x1C) {
            // INC E
            this.E = this.incrementRegister(this.E);
            this.PC++;
            return 4;
        }
        else if ([0x13, 0x23, 0x24, 0x2C, 0x34, 0x3C].includes(op)) {
            const opMap = {
                0x13: () => this.incrementDE(),
                0x23: () => this.incrementHL(),
                0x24: () => this.incrementH(),
                0x2C: () => this.incrementL(),
                0x34: () => {
                    const value = this.bus.readByte(this.HL);
                    const [result,] = wrappingByteAdd(value, 1);
                    //this.updateHalfCarryFlag(value, 1);
                    this.clearFlag(exports.HALF_CARRY_FLAG);
                    if (((result[0] ^ value ^ 1) & 0x10) == 0x10) {
                        this.setFlag(exports.HALF_CARRY_FLAG);
                    }
                    this.clearFlag(exports.SUBTRACTION_FLAG);
                    this.updateZeroFlag(result);
                    this.bus.writeByte(this.HL, result);
                },
                0x3C: () => {
                    const result = wrappingByteAdd(this.A, 1);
                    //this.updateHalfCarryFlag(this.A, 1);
                    this.clearFlag(exports.HALF_CARRY_FLAG);
                    if (((result[0] ^ this.A ^ 1) & 0x10) == 0x10) {
                        this.setFlag(exports.HALF_CARRY_FLAG);
                    }
                    this.clearFlag(exports.SUBTRACTION_FLAG);
                    this.updateZeroFlag(result[0]);
                    this.A = result[0];
                }
            };
            if (opMap[op]) {
                opMap[op]();
            }
            this.PC++;
            if (op === 0x34) {
                return 12;
            }
            return [0x13, 0x23].includes[op] ? 8 : 4;
        }
        else if (op >= 0x90 && op <= 0x97 || op === 0xD6) {
            // SUB n
            // Subtract n from A
            if (op === 0xD6) {
                const value = this.bus.readByte(this.PC + 1);
                this.A = this.subOneByte(this.A, value);
                this.PC += 2;
                return 8;
            }
            if (op === 0x96) {
                const value = this.bus.readByte(this.HL);
                this.A = this.subOneByte(this.A, value);
                this.PC++;
                return 8;
            }
            const opMap = {
                0x90: () => { return this.subOneByte(this.A, this.B); },
                0x91: () => { return this.subOneByte(this.A, this.C); },
                0x92: () => { return this.subOneByte(this.A, this.D); },
                0x93: () => { return this.subOneByte(this.A, this.E); },
                0x94: () => { return this.subOneByte(this.A, this.H()); },
                0x95: () => { return this.subOneByte(this.A, this.L()); },
                0x97: () => { return this.subOneByte(this.A, this.A); }
            };
            this.A = opMap[op]();
            this.PC++;
            return 4;
        }
        else if (op === 0xF8) {
            // https://stackoverflow.com/questions/5159603/gbz80-how-does-ld-hl-spe-affect-h-and-c-flags/7261149
            // https://stackoverflow.com/questions/57958631/game-boy-half-carry-flag-and-16-bit-instructions-especially-opcode-0xe8
            // `LD HL, SP + ${value}`;
            // TODO: half-carry AND carry flags might not be setting correctly
            const value = this.bus.readByte(this.PC + 1);
            const offset = utils_1.makeSigned(value, 1);
            const result = wrappingTwoByteAdd(this.SP, offset);
            //this.updateHalfCarryFlag(this.SP, offset);
            if (((result[0] ^ this.SP ^ offset) & 0x1000) == 0x1000) {
                this.setFlag(exports.HALF_CARRY_FLAG);
            }
            else {
                this.clearFlag(exports.HALF_CARRY_FLAG);
            }
            this.clearFlag(exports.CARRY_FLAG);
            if (result[1]) {
                this.setFlag(exports.CARRY_FLAG);
            }
            this.HL = result[0];
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.clearFlag(exports.ZERO_FLAG);
            this.PC += 2;
            return 12;
        }
        else if (op >= 0xB8 && op <= 0xBF) {
            // Compare A with n. This is basically an A - n subtraction instruction but the results are thrown away.
            // CP d8
            const value = this.getRegisterValueInvolved(op);
            let result = wrappingByteSub(this.A, value);
            this.updateZeroFlag(result[0]);
            this.setFlag(exports.SUBTRACTION_FLAG);
            this.updateSubHalfCarryFlag(this.A, value);
            result[1] ? this.setFlag(exports.CARRY_FLAG) : this.clearFlag(exports.CARRY_FLAG);
            this.PC++;
            return op === 0xBE ? 8 : 4;
        }
        else if (op === 0x27) {
            // DAA
            this.daaInstruction();
            this.PC++;
            return 4;
        }
        else if (op === 0x2E) {
            // LD L,d8
            const value = this.bus.readByte(this.PC + 1);
            this.updateL(value);
            this.PC += 2;
            return 8;
        }
        else if (op === 0x1B) {
            // DEC DE
            this.decrementDE();
            this.PC++;
            return 8;
        }
        else if (op === 0x2B) {
            // DEC HL
            this.decrementHL();
            this.PC++;
            return 8;
        }
        else if (op === 0x37) {
            // SCF
            // Set Carry flag
            this.setFlag(exports.CARRY_FLAG);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.clearFlag(exports.HALF_CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x3F) {
            // CCF
            // Complement carry flag
            this.getFlag(exports.CARRY_FLAG) ? this.clearFlag(exports.CARRY_FLAG) : this.setFlag(exports.CARRY_FLAG);
            this.clearFlag(exports.SUBTRACTION_FLAG);
            this.clearFlag(exports.HALF_CARRY_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x98) {
            // SBC B
            this.A = this.sbcInstruction(this.B);
            this.PC++;
            return 4;
        }
        else if (op === 0x99) {
            // SBC C
            this.A = this.sbcInstruction(this.C);
            this.PC++;
            return 4;
        }
        else if (op === 0x9A) {
            this.A = this.sbcInstruction(this.D);
            this.PC++;
            return 4;
        }
        else if (op === 0x9B) {
            this.A = this.sbcInstruction(this.E);
            this.PC++;
            return 4;
        }
        else if (op === 0x9C) {
            this.A = this.sbcInstruction(this.H());
            this.PC++;
            return 4;
        }
        else if (op === 0x9D) {
            this.A = this.sbcInstruction(this.L());
            this.PC++;
            return 4;
        }
        else if (op === 0x9E) {
            const value = this.bus.readByte(this.HL);
            this.A = this.sbcInstruction(value);
            this.PC++;
            return 8;
        }
        else if (op === 0x9F) {
            // SBC A
            this.sbcInstruction(this.A);
            this.PC++;
            return 4;
        }
        else if (op === 0xA8) {
            // XOR B
            this.A = this.A ^ this.B;
            this.updateZeroFlagAndClearOthers();
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
        else if (op === 0xAA) {
            // XOR D
            this.A = this.A ^ this.D;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xAB) {
            // XOR E
            this.A = this.A ^ this.E;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xAC) {
            // XOR H
            this.A = this.A ^ this.H();
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xAD) {
            // XOR L
            this.A = this.A ^ this.L();
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0xAE) {
            // XOR (HL)
            const value = this.bus.readByte(this.HL);
            this.A = this.A ^ value;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 8;
        }
        else if (op === 0xAF) {
            // XOR A
            this.A = this.A ^ this.A;
            this.updateZeroFlagAndClearOthers();
            this.PC++;
            return 4;
        }
        else if (op === 0x17) {
            // RLA
            this.A = this.rotateLeftThroughCarry(this.A);
            this.clearFlag(exports.ZERO_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x0F) {
            // RRCA
            // Rotate A right. Old bit 0 to Carry flag.
            this.A = this.rotateRight(this.A);
            this.clearFlag(exports.ZERO_FLAG);
            this.PC++;
            return 4;
        }
        else if (op === 0x23) {
            // INC HL
            this.incrementHL();
            this.PC++;
            return 8;
        }
        else if (op === 0xC4) {
            // CALL NZ, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (!this.getFlag(exports.ZERO_FLAG)) {
                // push address after this instruction on to the stack
                this.pushAddressOnStack(this.PC + 3); // 3 because this instruction is 3 bytes long 
                this.PC = addr;
                return 24;
            }
            this.PC += 3;
            return 12;
        }
        else if (op === 0xD4) {
            // CALL NC, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (!this.getFlag(exports.CARRY_FLAG)) {
                // push address after this instruction on to the stack
                this.pushAddressOnStack(this.PC + 3); // 3 because this instruction is 3 bytes long 
                this.PC = addr;
                return 24;
            }
            this.PC += 3;
            return 12;
        }
        else if (op === 0xCC) {
            // CALL Z, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (this.getFlag(exports.ZERO_FLAG)) {
                // push address after this instruction on to the stack
                this.pushAddressOnStack(this.PC + 3); // 3 because this instruction is 3 bytes long 
                this.PC = addr;
                return 24;
            }
            this.PC += 3;
            return 12;
        }
        else if (op === 0xDC) {
            // CALL C, a16
            const addr = this.readTwoByteValue(this.PC + 1);
            if (this.getFlag(exports.CARRY_FLAG)) {
                // push address after this instruction on to the stack
                this.pushAddressOnStack(this.PC + 3); // 3 because this instruction is 3 bytes long 
                this.PC = addr;
                return 24;
            }
            this.PC += 3;
            return 12;
        }
        else if (op === 0xCF) {
            // RST 0x08
            this.rstInstruction(0x08); // fn changes PC address
            return 16;
        }
        else if (op === 0xDF) {
            // RST 0x18
            this.rstInstruction(0x18); // fn changes PC address
            return 16;
        }
        else if (op === 0xEF) {
            // RST 0x28
            this.rstInstruction(0x28); // fn changes PC address
            return 16;
        }
        else if (op === 0xC7) {
            // RST 0x00
            this.rstInstruction(0x00); // fn changes PC address
            return 16;
        }
        else if (op === 0xD7) {
            // RST 0x10
            this.rstInstruction(0x10); // fn changes PC address
            return 16;
        }
        else if (op === 0xE7) {
            // RST 0x20
            this.rstInstruction(0x20); // fn changes PC address
            return 16;
        }
        else if (op === 0xF7) {
            // RST 0x30
            this.rstInstruction(0x30); // fn changes PC address
            return 16;
        }
        else if (op === 0xCB) {
            let nextInstrByte = this.bus.readByte(this.PC + 1);
            switch (nextInstrByte) {
                case 0x00:
                    // RLC B
                    this.B = this.rotateLeft(this.B);
                    this.PC += 2;
                    return 8;
                case 0x01:
                    // RLC C
                    this.C = this.rotateLeft(this.C);
                    this.PC += 2;
                    return 8;
                case 0x02:
                    // RLC D
                    this.D = this.rotateLeft(this.D);
                    this.PC += 2;
                    return 8;
                case 0x03:
                    // RLC E
                    this.E = this.rotateLeft(this.E);
                    this.PC += 2;
                    return 8;
                case 0x04:
                    // RLC H
                    this.updateH(this.rotateLeft(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x05:
                    // RLC L
                    this.updateL(this.rotateLeft(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x06:
                    // RLC (HL)
                    let b = this.bus.readByte(this.HL);
                    b = this.rotateLeft(b);
                    this.bus.writeByte(this.HL, b);
                    this.PC += 2;
                    return 8;
                case 0x07:
                    // RLC A
                    this.A = this.rotateLeft(this.A);
                    this.PC += 2;
                    return 8;
                case 0x08:
                    // RRC B
                    this.B = this.rotateRight(this.B);
                    this.PC += 2;
                    return 8;
                case 0x09:
                    // RRC C
                    this.C = this.rotateRight(this.C);
                    this.PC += 2;
                    return 8;
                case 0x0A:
                    // RRC D
                    this.D = this.rotateRight(this.D);
                    this.PC += 2;
                    return 8;
                case 0x0B:
                    // RRC E
                    this.E = this.rotateRight(this.E);
                    this.PC += 2;
                    return 8;
                case 0x0C:
                    // RRC H
                    this.updateH(this.rotateRight(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x0D:
                    // RRC L
                    this.updateL(this.rotateRight(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x0E:
                    // RRC (HL)
                    let b2 = this.bus.readByte(this.HL);
                    b2 = this.rotateRight(b2);
                    this.bus.writeByte(this.HL, b2);
                    this.PC += 2;
                    return 8;
                case 0x0F:
                    // RRC A
                    this.A = this.rotateRight(this.A);
                    this.PC += 2;
                    return 8;
                case 0x10:
                    // RL B
                    this.B = this.rotateLeftThroughCarry(this.B);
                    this.PC += 2;
                    return 8;
                case 0x11:
                    // RL C
                    this.C = this.rotateLeftThroughCarry(this.C);
                    this.PC += 2;
                    return 8;
                case 0x12:
                    // RL D
                    this.D = this.rotateLeftThroughCarry(this.D);
                    this.PC += 2;
                    return 8;
                case 0x13:
                    // RL E
                    this.E = this.rotateLeftThroughCarry(this.E);
                    this.PC += 2;
                    return 8;
                case 0x14:
                    // RL H
                    this.updateH(this.rotateLeftThroughCarry(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x15:
                    // RL L
                    this.updateL(this.rotateLeftThroughCarry(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x16:
                    // RL (HL)
                    let b3 = this.bus.readByte(this.HL);
                    b3 = this.rotateLeftThroughCarry(b3);
                    this.bus.writeByte(this.HL, b3);
                    this.PC += 2;
                    return 8;
                case 0x17:
                    // RL A
                    this.A = this.rotateLeftThroughCarry(this.A);
                    this.PC += 2;
                    return 8;
                case 0x18:
                    // 'RR B'
                    this.B = this.rotateRightThroughCarry(this.B);
                    this.PC += 2;
                    return 8;
                case 0x19:
                    // 'RR C'
                    // Rotate n right through Carry flag.
                    this.C = this.rotateRightThroughCarry(this.C);
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
                    const b6 = this.bus.readByte(this.HL);
                    this.bus.writeByte(this.HL, this.rotateRightThroughCarry(b6));
                    this.PC += 2;
                    return 16;
                case 0x1F:
                    // 'RR A';
                    this.A = this.rotateRightThroughCarry(this.A);
                    this.PC += 2;
                    return 8;
                case 0x20:
                    // SLA B
                    this.B = this.shiftLeftIntoCarry(this.B);
                    this.PC += 2;
                    return 8;
                case 0x21:
                    // SLA C
                    this.C = this.shiftLeftIntoCarry(this.C);
                    this.PC += 2;
                    return 8;
                case 0x22:
                    // SLA D
                    this.D = this.shiftLeftIntoCarry(this.D);
                    this.PC += 2;
                    return 8;
                case 0x23:
                    // SLA E
                    this.E = this.shiftLeftIntoCarry(this.E);
                    this.PC += 2;
                    return 8;
                case 0x24:
                    // SLA H
                    this.updateH(this.shiftLeftIntoCarry(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x25:
                    // SLA L
                    this.updateL(this.shiftLeftIntoCarry(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x26:
                    // SLA (HL)
                    const b4 = this.bus.readByte(this.HL);
                    this.bus.writeByte(this.HL, this.shiftLeftIntoCarry(b4));
                case 0x27:
                    // SLA A
                    // Shift n left into Carry. LSB of n set to 0
                    this.A = this.shiftLeftIntoCarry(this.A);
                    this.PC += 2;
                    return 8;
                case 0x28:
                    // SRA B
                    this.B = this.shiftRightIntoCarry(this.B);
                    this.PC += 2;
                    return 8;
                case 0x29:
                    // SRA C
                    this.C = this.shiftRightIntoCarry(this.C);
                    this.PC += 2;
                    return 8;
                case 0x2A:
                    // SRA D
                    this.D = this.shiftRightIntoCarry(this.D);
                    this.PC += 2;
                    return 8;
                case 0x2B:
                    // SRA E
                    this.E = this.shiftRightIntoCarry(this.E);
                    this.PC += 2;
                    return 8;
                case 0x2C:
                    // SRA H
                    this.updateH(this.shiftRightIntoCarry(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x2D:
                    // SRA L
                    this.updateL(this.shiftRightIntoCarry(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x2E:
                    // SRA (HL)
                    const b5 = this.bus.readByte(this.HL);
                    this.bus.writeByte(this.HL, this.shiftRightIntoCarry(b5));
                    this.PC += 2;
                    return 8;
                case 0x2F:
                    // SRA A
                    this.A = this.shiftRightIntoCarry(this.A);
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
                case 0x37:
                    // SWAP A
                    this.swapNibblesOf(this.A);
                    this.PC += 2;
                    return 8;
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
                    this.B = this.shiftRight(this.B);
                    this.PC += 2;
                    return 8;
                case 0x39:
                    // SRL C
                    this.C = this.shiftRight(this.C);
                    this.PC += 2;
                    return 8;
                case 0x3A:
                    // SRL D
                    this.D = this.shiftRight(this.D);
                    this.PC += 2;
                    return 8;
                case 0x3B:
                    // SRL E
                    this.E = this.shiftRight(this.E);
                    this.PC += 2;
                    return 8;
                case 0x3C:
                    // SRL H
                    this.updateH(this.shiftRight(this.H()));
                    this.PC += 2;
                    return 8;
                case 0x3D:
                    // SRL L
                    this.updateL(this.shiftRight(this.L()));
                    this.PC += 2;
                    return 8;
                case 0x3E:
                    // SRL (HL)
                    const v = this.bus.readByte(this.HL);
                    const updated = this.shiftRightIntoCarry(v);
                    this.bus.writeByte(this.HL, updated);
                    this.PC += 2;
                    return 16;
                case 0x3F:
                    // SRL E
                    this.A = this.shiftRightIntoCarry(this.A);
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
    sbcInstruction(value) {
        const carryFlag = this.getFlag(exports.CARRY_FLAG) ? 1 : 0;
        return this.subOneByte(this.A, value, carryFlag);
    }
    rstInstruction(rstAddr) {
        this.pushAddressOnStack(this.PC + 1);
        this.PC = rstAddr;
    }
    // NO BUGS HERE. LITERALLY A PERFECT IMPLEMENTATION
    daaInstruction() {
        if (!this.getFlag(exports.SUBTRACTION_FLAG)) {
            if (this.getFlag(exports.HALF_CARRY_FLAG) || (this.A & 0x0F) > 9) {
                this.A += 0x06;
            }
            if (this.getFlag(exports.CARRY_FLAG) || this.A > 0x9F) {
                this.A += 0x60;
            }
        }
        else {
            if (this.getFlag(exports.HALF_CARRY_FLAG)) {
                this.A = (this.A - 6) & 0xFF;
            }
            if (this.getFlag(exports.CARRY_FLAG)) {
                this.A -= 0x60;
            }
        }
        this.clearFlag(exports.HALF_CARRY_FLAG);
        if ((this.A & 0x100) === 0x100) {
            this.setFlag(exports.CARRY_FLAG);
        }
        this.A &= 0xFF;
        this.clearFlag(exports.ZERO_FLAG);
        if (this.A === 0) {
            this.setFlag(exports.ZERO_FLAG);
        }
    }
    pushAddressOnStack(returnAddr) {
        const [higherByte, lowerByte] = this.split16BitValueIntoTwoBytes(returnAddr);
        this.stackPush(higherByte);
        this.stackPush(lowerByte);
    }
    rotateLeftThroughCarry(value) {
        const currCarry = this.Flags.carryFlag;
        this.Flags.carryFlag = (value & 0x80) === 0x80;
        let updated = value << 1;
        if (currCarry) {
            updated ^= 0x01;
        }
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    rotateLeft(value) {
        const bit7 = (value & 0x80) === 0x80;
        let updated = value << 1;
        this.clearFlag(exports.CARRY_FLAG);
        if (bit7) {
            this.setFlag(exports.CARRY_FLAG);
            updated ^= 0x01;
        }
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    rotateRightThroughCarry(value) {
        // 1001 1010
        // 0011 010[0] | [1]
        const currCarry = this.Flags.carryFlag ? 0x80 : 0x00;
        this.Flags.carryFlag = (value & 0x01) === 0x01;
        let updated = value >>> 1;
        if (currCarry === 0x80) {
            updated ^= currCarry;
        }
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    rotateRight(value) {
        const bit0 = (value & 0x01) === 0x01;
        let updated = value >>> 1;
        this.clearFlag(exports.CARRY_FLAG);
        if (bit0) {
            this.setFlag(exports.CARRY_FLAG);
            updated ^= 0x80;
        }
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    // 0x28 - 0x2F
    shiftRightIntoCarry(value) {
        this.clearFlag(exports.CARRY_FLAG);
        if ((value & 0x01) === 0x01) {
            this.setFlag(exports.CARRY_FLAG);
        }
        const updated = (value >>> 1) | (value & 0x80);
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    shiftLeftIntoCarry(value) {
        this.clearFlag(exports.CARRY_FLAG);
        if ((value & 0x80) === 0x80) {
            this.setFlag(exports.CARRY_FLAG);
        }
        const updated = value << 1;
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        return updated;
    }
    shiftRight(value) {
        this.clearFlag(exports.CARRY_FLAG);
        if ((value & 0x01) === 0x01) {
            this.setFlag(exports.CARRY_FLAG);
        }
        const updated = value >>> 1;
        this.Flags.zeroFlag = updated === 0x00;
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
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
    // TODO: Only used by 0xF6 opcode
    executeOr(operand) {
        this.A = this.A | operand;
        this.updateZeroFlag(this.A);
        this.clearFlag(exports.SUBTRACTION_FLAG);
        this.clearFlag(exports.HALF_CARRY_FLAG);
        this.clearFlag(exports.CARRY_FLAG);
        return 8;
    }
    // @return number => the resulting value after its nibbles are swapped
    swapNibblesOf(value) {
        // swap upper and lower nibbles of A
        // const upper = (value & 0xF0) >> 4;
        // const lower = value & 0x0F;
        // value = (lower << 4) | upper;
        value = ((value & 0xF0) >> 4) ^ ((value & 0x0F) << 4);
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
        //if ((((a & 0xF) - (b & 0xF)) & 0x10) === 0x10) {
        if ((a & 0xF) < (b & 0xF)) {
            this.setFlag(exports.HALF_CARRY_FLAG);
        }
        else {
            this.clearFlag(exports.HALF_CARRY_FLAG);
        }
    }
    // for addition operations
    updateHalfCarryFlag(a, b) {
        // check half-carry for 2-byte value
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
    constructor(opts) {
        const { inDebugMode = false, readlineSync = null, inFrameExecutionMode = false, onFrame = () => { } } = opts;
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
        this.inFrameExecutionMode = inFrameExecutionMode;
        this.onFrame = onFrame;
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
    // Keep executing instructions until VBLANK is complete
    // (until LY reaches specific value)
    // this will be executed 60 times a second
    async executeNextFrame() {
        let keepRunning = true;
        // LY === 144 indicates VBLANK. VBLANK means that the screen just finished rendering pixels to the screen
        let hasFinishedFrame = false;
        let instructionsExecuted = 0;
        while (keepRunning && !hasFinishedFrame) {
            const previousLY = this.ppu.LY;
            keepRunning = await this.executeNextTick();
            hasFinishedFrame = this.ppu.LY === 144 && this.ppu.LY !== previousLY;
            // screen finished rendering so invoke passed in onFrame callback
            //this.onFrame(this.ppu.getScreenBuffer());
            instructionsExecuted++;
        }
        console.log(`Finished executing next frame. Executed ${instructionsExecuted} instructions`);
        // screen finished rendering so invoke passed in onFrame callback
        this.onFrame(this.ppu.getScreenBuffer());
        return keepRunning;
    }
    readNextOpCode() {
        const op = this.bus.readByte(this.cpu.PC);
        if (op === 0xCB) {
            const nextByte = this.bus.readByte(this.cpu.PC + 1);
            return (op << 8) | nextByte;
        }
        return op;
    }
    // @return boolean => should we continue executing
    async executeNextTick() {
        const prevProgramCounter = this.cpu.PC;
        if (ADDRESS_TRACING_MODE) {
            this.debugger.recordAddress(this.cpu);
        }
        if (this.inDebugMode && this.debugger.shouldShowDebugger()) {
            // suspend execution until a key is pressed
            const op = this.readNextOpCode();
            this.cpu.lastExecutedOpCode = op;
            const disassembled = this.cpu.disassembleNextInstruction(op) || "<unknown>";
            console.log(`* [${utils_1.displayAsHex(prevProgramCounter)}]: ${disassembled} {op = ${utils_1.displayAsHex(op)}}`);
            this.debugger.showConsole();
        }
        // ExecuteNextInstruction will modify the PC register appropriately
        const cycles = this.cpu.executeInstruction();
        if (cycles === 0) {
            return false;
        }
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
        this.ppu.step(cycles);
        // check if V Blank Interrupt was requested
        if (this.processInterrupts()) {
            // interrupt was invoked. Do nothing else and start executing the interrupt immediately
            this.debugger.pushCallAddress(this.cpu.PC);
            return true;
        }
        if (this.cpu.shouldEnableInterrupts) {
            this.cpu.enableInterrupts();
        }
        return true;
    }
    async executeRom() {
        let keepRunning = true;
        while (keepRunning) {
            if (this.inFrameExecutionMode) {
                //const t0 = performance.now();
                keepRunning = await this.executeNextFrame();
                //const t1 = performance.now();
                //console.log(`executeNextFrame took ${t1 - t0} milliseconds.`);
                // pause execution. show the debug console
                if (keepRunning) {
                    this.debugger.showConsole();
                }
            }
            else {
                keepRunning = await this.executeNextTick();
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
        else if (romHeader.cartridgeType in [0x01, 0x02, 0x03]) { // MBC1
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
    displayRomHeader() {
        const header = this.getRomHeaderInfo();
        console.log(`
            RomTitle = ${header.romTitle}
            SGBSupported = ${header.SGBSupported}
            LicenseCode = ${this.licenseCodeDisplayName(header.licenseCode)}
            CartridgeType = ${this.cartridgeTypeDisplayName(header.cartridgeType)}
            RomSize = ${this.romSizeDisplayName(header.romSize)}
            RamSize = ${this.ramSizeDisplayName(header.ramSize)}
        `);
    }
    licenseCodeDisplayName(licenseCode) {
        // 00	none	01	Nintendo R&D1	08	Capcom
        // 13	Electronic Arts	18	Hudson Soft	19	b-ai
        // 20	kss	22	pow	24	PCM Complete
        // 25	san-x	28	Kemco Japan	29	seta
        // 30	Viacom	31	Nintendo	32	Bandai
        // 33	Ocean/Acclaim	34	Konami	35	Hector
        // 37	Taito	38	Hudson	39	Banpresto
        // 41	Ubi Soft	42	Atlus	44	Malibu
        // 46	angel	47	Bullet-Proof	49	irem
        // 50	Absolute	51	Acclaim	52	Activision
        // 53	American sammy	54	Konami	55	Hi tech entertainment
        // 56	LJN	57	Matchbox	58	Mattel
        // 59	Milton Bradley	60	Titus	61	Virgin
        // 64	LucasArts	67	Ocean	69	Electronic Arts
        // 70	Infogrames	71	Interplay	72	Broderbund
        // 73	sculptured	75	sci	78	THQ
        // 79	Accolade	80	misawa	83	lozc
        // 86	tokuma shoten i*	87	tsukuda ori*	91	Chunsoft
        // 92	Video system	93	Ocean/Acclaim	95	Varie
        // 96	Yonezawa/s'pal	97	Kaneko	99	Pack in soft
        // A4	Konami (Yu-Gi-Oh!)
        return {
            0x00: "None", 0x01: "Nintendo R&D1", 0x08: "Capcom", 0x13: "Electronic Arts",
            0x18: "Hudson Soft", 0x19: "b-ai", 0x20: "kss 22  pow", 0x24: "PCM Complete"
        }[licenseCode] || "<unknown>";
    }
    romSizeDisplayName(romSize) {
        // 00h -  32KByte (no ROM banking)
        // 01h -  64KByte (4 banks)
        // 02h - 128KByte (8 banks)
        // 03h - 256KByte (16 banks)
        // 04h - 512KByte (32 banks)
        // 05h -   1MByte (64 banks)  - only 63 banks used by MBC1
        // 06h -   2MByte (128 banks) - only 125 banks used by MBC1
        // 07h -   4MByte (256 banks)
        // 08h -   8MByte (512 banks)
        // 52h - 1.1MByte (72 banks)
        // 53h - 1.2MByte (80 banks)
        // 54h - 1.5MByte (96 banks)
        return {
            0x00: "32KB (no banks)", 0x01: "64KB (4 banks)", 0x02: "128KB (8 banks)",
            0x03: "256KB (16 banks)", 0x04: "512KB (32 banks)", 0x05: "1MB (64 banks)",
            0x06: "2MB (128 banks)", 0x07: "4MB (256 banks)", 0x08: "8MB (512 banks)",
            0x52: "1.1MB (72 banks)", 0x53: "1.2MB (80 banks)", 0x54: "1.5MB (96 banks)"
        }[romSize] || "<unknown";
    }
    ramSizeDisplayName(ramSize) {
        // 00h - None
        // 01h - 2 KBytes
        // 02h - 8 Kbytes
        // 03h - 32 KBytes (4 banks of 8KBytes each)
        // 04h - 128 KBytes (16 banks of 8KBytes each)
        // 05h - 64 KBytes (8 banks of 8KBytes each)
        return {
            0x00: "None", 0x01: "2KB", 0x02: "8KB", 0x03: "32KB (4 banks of 8KB each)",
            0x04: "128KB (16 banks of 8KB each)", 0x05: "64KB (8 banks of 8KB each"
        }[ramSize] || "<unknown>";
    }
    // https://gbdev.gg8.se/wiki/articles/Gameboy_ROM_Header_Info#Cartridge_type
    cartridgeTypeDisplayName(cartridgeType) {
        const displayNames = {
            0x00: "MBC0",
            0x01: "MBC1",
            0x02: "MBC1 + RAM",
            0x03: "MBC1 + RAM + BATTERY",
            0x05: "MBC2",
            0x06: "MBC2 + BATTERY",
            0x08: "ROM + RAM",
            0x09: "ROM + RAM + BATTERY",
            0x0B: "MMM01",
            0x0C: "MMM01 + RAM",
            0x0D: "MMM01 + RAM + BATTERY",
            0x0F: "MBC3 + TIMER + BATTERY",
            0x10: "MBC3 + TIMER + RAM + BATTERY",
            0x11: "MBC3",
            0x12: "MBC3 + RAM",
            0x13: "MBC3 + RAM + BATTERY"
        };
        return displayNames[cartridgeType] || "<unknown>";
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
