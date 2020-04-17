import { Gameboy, ZERO_FLAG, SUBTRACTION_FLAG, HALF_CARRY_FLAG, CARRY_FLAG } from "./emulator";
import { loadTextFile } from "./utils";
import * as readlineSync from "readline-sync";

export function loadBreakpoints(filename: string): Breakpoint[] {
    const breakpointsContents = loadTextFile(filename);
    const breakpoints: Breakpoint[] = [];
    
    for (const line of breakpointsContents.split("\n")) {
        const bp = Breakpoint.from(line);
        if (bp) {
          breakpoints.push(bp);
        }
    }

    return breakpoints;
}

abstract class Breakpoint {
    static from(command: string): Breakpoint {
      const words = command.toLowerCase().split(' ');
      console.log(`words = ${words.join('|')}`);
      const cmd = words[0];
      const args = words.slice(1);

      if (cmd === "address") {
        const addr = parseInt(args[0], 16);
        return new AddressBreakpoint(addr);
      } else if (cmd === "address-value-change") {
        const addr = parseInt(args[0], 16);
        return new AddressValueChangeBreakpoint(addr);
      } else if (cmd === "address-range-value-change") {
        const startAddr = parseInt(args[0], 16);
        const endAddr = parseInt(args[0], 16);
        return new AddressRangeValueChangeBreakpoint(startAddr, endAddr);
      }
    }

    abstract hasTriggered(gb: Gameboy): boolean;
}

export class AddressBreakpoint {
   public address: number;

   constructor(address: number) {
       this.address = address;
   }

   public hasTriggered(gb: Gameboy): boolean {
       return gb.cpu.PC === this.address;
   }

   public toString() {
       return `<AddressBreakpoint addr=${this.address}>`;
   }
}

export class AddressValueChangeBreakpoint {
    public address: number;

    constructor(address: number) {
        this.address = address;
    }
 
    public hasTriggered(gb: Gameboy): boolean {
        return false;
    }
}

export class AddressRangeValueChangeBreakpoint {
    public startAddr: number;
    public endAddr: number;
    
    constructor(startAddr: number, endAddr: number) {
        this.startAddr = startAddr;
        this.endAddr = endAddr;
    }

    public hasTriggered(gb: Gameboy): boolean {
        return false;
    }
}

export class DebugConsole {
    private gameboy: Gameboy;
    private breakpoints: Breakpoint[];

    // When true the debugger repl will display after each instruction execution
    private inDebuggerMode = false;

    constructor(gb: Gameboy) {
        this.gameboy = gb;
        this.breakpoints = loadBreakpoints("./breakpoints");
    }

    public breakpointTriggered() {
        for (let i = 0; i < this.breakpoints.length; i++) {
            if (this.breakpoints[i] && this.breakpoints[i].hasTriggered(this.gameboy)) {
                return true;
            }
        }
        return false;
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