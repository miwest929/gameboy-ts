import { Gameboy, ZERO_FLAG, SUBTRACTION_FLAG, HALF_CARRY_FLAG, CARRY_FLAG } from "./emulator";
// import { LCDC, PPU } from "./ppu";
import * as readlineSync from "readline-sync";

export class DebugConsole {
    private gameboy: Gameboy;
    private breakpoints: number[];

    // When true the debugger repl will display after each instruction execution
    private inDebuggerMode = false;

    constructor(gb: Gameboy) {
        this.gameboy = gb;
        this.breakpoints = [];
    }

    public addBreakpoint(addr: number) {
        this.breakpoints.push(addr);
    }

    public breakpointTriggered(currAddr: number) {
        return currAddr in this.breakpoints;
    }

    public displayPPUData() {
        console.log(`
        ---------------------- PPU ---------------------
        LX = ${this.gameboy.ppu.LX}
        LY = ${this.gameboy.ppu.LY}
        WINDOWX = ${this.gameboy.ppu.WINDOWX}
        WINDOWY = ${this.gameboy.ppu.WINDOWY}
        isDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isDisplayOn()}
        isWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isWindowDisplayOn()}
        isObjSpriteDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isObjSpriteDisplayOn()}
        isBackgroundAndWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isBackgroundAndWindowDisplayOn()}
        ---------------------- PPU ---------------------
        `);
    }

    public displayCPUData() {
        console.log(`
        ---------------------- CPU ---------------------
        PC = ${this.gameboy.cpu.PC}
        A = ${this.gameboy.cpu.A}
        B = ${this.gameboy.cpu.B}
        C = ${this.gameboy.cpu.C}
        D = ${this.gameboy.cpu.D}
        E = ${this.gameboy.cpu.E}
        SP = ${this.gameboy.cpu.SP}
        ZeroFlag = ${this.gameboy.cpu.getFlag(ZERO_FLAG)}
        SubtractionFlag = ${this.gameboy.cpu.getFlag(SUBTRACTION_FLAG)}
        HalfCarry = ${this.gameboy.cpu.getFlag(HALF_CARRY_FLAG)}
        CarryFlag = ${this.gameboy.cpu.getFlag(CARRY_FLAG)}
        ---------------------- CPU ---------------------
        `);
    }

    public inDebuggerActive() {
        return this.inDebuggerMode;
    }

    public showConsole() {
        // When true the reply will continue to prompt user for debugger commands
        // the NEXT and CONTINUE command will exit this loop
        let showDebugger = true;

        while (showDebugger) {
            const command = readlineSync.question(`(h for help, c for continue) [${this.gameboy.cpu.PC}]> `, {hideEchoBack: false});

            if (command === "p cpu") {
                this.displayCPUData();
            } else if (command === "p ppu") {
                this.displayPPUData();
            } else if (command === "n" || command === "next") {
                // next instruction
                showDebugger = false;
                this.inDebuggerMode = true;
            } else if (command === "c" || command === "continue") {
                showDebugger = false;
                this.inDebuggerMode = false;
            }
        }
    } 
}