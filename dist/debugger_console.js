"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugConsole = exports.AddressRangeValueChangeBreakpoint = exports.AddressValueChangeBreakpoint = exports.OpCodeBreakpoint = exports.AddressBreakpoint = exports.loadBreakpoints = void 0;
const emulator_1 = require("./emulator");
const utils_1 = require("./utils");
function loadBreakpoints(filename) {
    const breakpointsContents = utils_1.loadTextFile(filename);
    const breakpoints = [];
    if (breakpointsContents === "") {
        return [];
    }
    for (const line of breakpointsContents.split("\n")) {
        const bp = Breakpoint.from(line);
        if (bp) {
            breakpoints.push(bp);
        }
    }
    return breakpoints;
}
exports.loadBreakpoints = loadBreakpoints;
class Breakpoint {
    static from(command) {
        const words = command.toLowerCase().split(' ');
        const cmd = words[0];
        const args = words.slice(1);
        if (cmd === "address") {
            const addr = parseInt(args[0], 16);
            return new AddressBreakpoint(addr);
        }
        else if (cmd === "address-value-change") {
            const addr = parseInt(args[0], 16);
            return new AddressValueChangeBreakpoint(addr);
        }
        else if (cmd === "address-range-value-change") {
            const startAddr = parseInt(args[0], 16);
            const endAddr = parseInt(args[0], 16);
            return new AddressRangeValueChangeBreakpoint(startAddr, endAddr);
        }
        else if (cmd === "opcode") {
            const opcode = parseInt(args[0], 16);
            return new OpCodeBreakpoint(opcode);
        }
    }
}
class AddressBreakpoint {
    constructor(address) {
        this.address = address;
    }
    hasTriggered(gb) {
        return gb.cpu.PC === this.address;
    }
    toString() {
        return `<AddressBreakpoint addr=${utils_1.displayAsHex(this.address)}>`;
    }
}
exports.AddressBreakpoint = AddressBreakpoint;
class OpCodeBreakpoint {
    constructor(opcode) {
        this.opcode = opcode;
    }
    hasTriggered(gb) {
        return gb.cpu.lastExecutedOpCode === this.opcode;
    }
    toString() {
        return `<OpCodeBreakpoint opcode=${this.opcode}>`;
    }
}
exports.OpCodeBreakpoint = OpCodeBreakpoint;
// trigger whenever the value at specified address has changed
class AddressValueChangeBreakpoint {
    constructor(address) {
        this.address = address;
    }
    hasTriggered(gb) {
        return false;
    }
    toString() {
        return `<AddressValueChangeBreakpoint addr=${this.address}>`;
    }
}
exports.AddressValueChangeBreakpoint = AddressValueChangeBreakpoint;
// trigger whenever the value at specified address RANGE has changed
class AddressRangeValueChangeBreakpoint {
    constructor(startAddr, endAddr) {
        this.startAddr = startAddr;
        this.endAddr = endAddr;
    }
    hasTriggered(gb) {
        return false;
    }
}
exports.AddressRangeValueChangeBreakpoint = AddressRangeValueChangeBreakpoint;
class DebugConsole {
    constructor(gb, readlineSync) {
        // When true the debugger repl will display after each instruction execution
        this.inDebuggerMode = false;
        this.gameboy = gb;
        this.breakpoints = loadBreakpoints("./breakpoints");
        this.pastAddresses = [0x100]; // 0x100 is the address start executing..
        this.readlineSync = readlineSync;
    }
    breakpointTriggered() {
        for (let i = 0; i < this.breakpoints.length; i++) {
            if (this.breakpoints[i] && this.breakpoints[i].hasTriggered(this.gameboy)) {
                return true;
            }
        }
        return false;
    }
    displayPPUData() {
        console.log(`
        ---------------------- PPU ---------------------
        LY = ${utils_1.displayAsHex(this.gameboy.ppu.LY)} (${this.gameboy.ppu.LY})
        WINDOWX = ${utils_1.displayAsHex(this.gameboy.ppu.WINDOWX)} (${this.gameboy.ppu.WINDOWX})
        WINDOWY = ${utils_1.displayAsHex(this.gameboy.ppu.WINDOWY)} (${this.gameboy.ppu.WINDOWY})
        ========================================================
        STAT = ${utils_1.displayAsHex(this.gameboy.ppu.LCDC_STATUS.RawValue)}
        LCDC = ${utils_1.displayAsHex(this.gameboy.ppu.LCDC_REGISTER.RawValue)}
        isDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isDisplayOn()}
        isWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isWindowDisplayOn()}
        isObjSpriteDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isObjSpriteDisplayOn()}
        isBackgroundAndWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isBackgroundAndWindowDisplayOn()}
        ========================================================
        STAT = ${utils_1.displayAsHex(this.gameboy.ppu.LCDC_STATUS.RawValue)}
        ---------------------- PPU ---------------------
        `);
    }
    displayCPUData() {
        console.log(`
        ---------------------- CPU ---------------------
        PC = ${utils_1.displayAsHex(this.gameboy.cpu.PC)}
        A = ${utils_1.displayAsHex(this.gameboy.cpu.A)}
        B = ${utils_1.displayAsHex(this.gameboy.cpu.B)}
        C = ${utils_1.displayAsHex(this.gameboy.cpu.C)}
        D = ${utils_1.displayAsHex(this.gameboy.cpu.D)}
        E = ${utils_1.displayAsHex(this.gameboy.cpu.E)}
        HL = ${utils_1.displayAsHex(this.gameboy.cpu.HL)}
        SP = ${utils_1.displayAsHex(this.gameboy.cpu.SP)}
        IME = ${utils_1.displayAsHex(this.gameboy.cpu.IME)}
        IF = ${utils_1.displayAsHex(this.gameboy.cpu.IF.RawValue)}
        IE = ${utils_1.displayAsHex(this.gameboy.cpu.IE.RawValue)}
        ZeroFlag = ${this.gameboy.cpu.getFlag(emulator_1.ZERO_FLAG)}
        SubtractionFlag = ${this.gameboy.cpu.getFlag(emulator_1.SUBTRACTION_FLAG)}
        HalfCarry = ${this.gameboy.cpu.getFlag(emulator_1.HALF_CARRY_FLAG)}
        CarryFlag = ${this.gameboy.cpu.getFlag(emulator_1.CARRY_FLAG)}
        ---------------------- CPU ---------------------
        `);
    }
    displayMemoryAddressValue(addr) {
        const value = this.gameboy.bus.readByte(addr);
        console.log(`
        ------------------------ RAM ADDRESS ---------------------
        Address = ${utils_1.displayAsHex(addr)} (${addr})
        RAM[${utils_1.displayAsHex(addr)}] = ${utils_1.displayAsHex(value)} (${value})
        ------------------------ RAM ADDRESS ---------------------
        `);
    }
    displayHelp() {
        console.log(`
        ---------------------------------------------------------------------
        p cpu -> Display CPU registers
        p ppu -> Display PPU info including special registers
        readmem $addr -> Display byte value at specified address. Addr is a hexadecimal value
        next (n) -> Execute the next instruction. Keep repl
        continue (c) -> Exit out of repl and continue executing instructions
        ---------------------------------------------------------------------
        `);
    }
    shouldShowDebugger() {
        return this.inDebuggerActive() || this.breakpointTriggered();
    }
    pushCallAddress(callAddr) {
        this.pastAddresses.push(callAddr);
    }
    popCallAddress() {
        this.pastAddresses.pop();
    }
    inDebuggerActive() {
        return this.inDebuggerMode;
    }
    showConsole() {
        // When true the reply will continue to prompt user for debugger commands
        // the NEXT and CONTINUE command will exit this loop
        let showDebugger = true;
        while (showDebugger) {
            const command = this.readlineSync.question(`(h for help, c for continue) [${utils_1.displayAsHex(this.gameboy.cpu.PC)}]> `, { hideEchoBack: false });
            if (command === "p cpu") {
                this.displayCPUData();
            }
            else if (command === "p ppu") {
                this.displayPPUData();
            }
            else if (command === "n" || command === "next") {
                // next instruction
                showDebugger = false;
                this.inDebuggerMode = true;
            }
            else if (command === "c" || command === "continue") {
                showDebugger = false;
                this.inDebuggerMode = false;
            }
            else if (command === "h" || command === "help") {
                this.displayHelp();
            }
            else if (command.startsWith('readmem')) {
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                this.displayMemoryAddressValue(addr);
            }
            else if (command === "setbp" || command === "setbreakpoint") {
                console.log("SETTING A BREAKPOINT");
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                this.breakpoints.push(new AddressBreakpoint(addr));
                console.log(`Set new breakpoint at address 0x${utils_1.displayAsHex(addr)}`);
            }
            else if (command === "listbp") {
                console.log("Following are the Address breakpoints:");
                const addressBps = this.breakpoints.filter((bp) => bp.constructor.name === 'AddressBreakpoint');
                const messages = addressBps.map((bp) => `${bp.toString()}`);
                console.log(messages.join('\n'));
            }
            else if (command === "trace") {
                // Display list of call addresses. Every time a call happens its address will be traced
                const formattedAddrs = this.pastAddresses.map((a) => utils_1.displayAsHex(a));
                console.log(`Address call stack: ${formattedAddrs.join(', ')}`);
            }
        }
    }
}
exports.DebugConsole = DebugConsole;
