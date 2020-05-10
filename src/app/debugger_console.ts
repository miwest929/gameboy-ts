import { Gameboy, ZERO_FLAG, SUBTRACTION_FLAG, HALF_CARRY_FLAG, CARRY_FLAG } from "./emulator";
import { loadTextFile, displayAsHex } from "./utils";
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
      } else if (cmd === "opcode") {
          const opcode = parseInt(args[0], 16);
          return new OpCodeBreakpoint(opcode);
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

export class OpCodeBreakpoint {
    public opcode: number;

    constructor(opcode: number) {
        this.opcode = opcode;
    }

    public hasTriggered(gb: Gameboy): boolean {
        return gb.cpu.lastExecutedOpCode === this.opcode;
    }

    public toString() {
        return `<OpCodeBreakpoint opcode=${this.opcode}>`;
    }
}

// trigger whenever the value at specified address has changed
export class AddressValueChangeBreakpoint {
    public address: number;

    constructor(address: number) {
        this.address = address;
    }
 
    public hasTriggered(gb: Gameboy): boolean {
        return false;
    }

    public toString() {
        return `<AddressValueChangeBreakpoint addr=${this.address}>`;
    }
}

// trigger whenever the value at specified address RANGE has changed
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
        LX = ${displayAsHex(this.gameboy.ppu.LX)} (${this.gameboy.ppu.LX})
        LY = ${displayAsHex(this.gameboy.ppu.LY)} (${this.gameboy.ppu.LY})
        WINDOWX = ${displayAsHex(this.gameboy.ppu.WINDOWX)} (${this.gameboy.ppu.WINDOWX})
        WINDOWY = ${displayAsHex(this.gameboy.ppu.WINDOWY)} (${this.gameboy.ppu.WINDOWY})
        ========================================================
        LCDC = ${displayAsHex(this.gameboy.ppu.LCDC_REGISTER.RawValue)}
        isDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isDisplayOn()}
        isWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isWindowDisplayOn()}
        isObjSpriteDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isObjSpriteDisplayOn()}
        isBackgroundAndWindowDisplayOn = ${this.gameboy.ppu.LCDC_REGISTER.isBackgroundAndWindowDisplayOn()}
        ========================================================
        STAT = ${displayAsHex(this.gameboy.ppu.LCDC_STATUS.RawValue)}
        ---------------------- PPU ---------------------
        `);
    }

    public displayCPUData() {
        console.log(`
        ---------------------- CPU ---------------------
        PC = ${displayAsHex(this.gameboy.cpu.PC)}
        A = ${displayAsHex(this.gameboy.cpu.A)}
        B = ${displayAsHex(this.gameboy.cpu.B)}
        C = ${displayAsHex(this.gameboy.cpu.C)}
        D = ${displayAsHex(this.gameboy.cpu.D)}
        E = ${displayAsHex(this.gameboy.cpu.E)}
        HL = ${displayAsHex(this.gameboy.cpu.HL)}
        SP = ${displayAsHex(this.gameboy.cpu.SP)}
        IME = ${displayAsHex(this.gameboy.cpu.IME)}
        IF = ${displayAsHex(this.gameboy.cpu.IF.RawValue)}
        IE = ${displayAsHex(this.gameboy.cpu.IE.RawValue)}
        ZeroFlag = ${this.gameboy.cpu.getFlag(ZERO_FLAG)}
        SubtractionFlag = ${this.gameboy.cpu.getFlag(SUBTRACTION_FLAG)}
        HalfCarry = ${this.gameboy.cpu.getFlag(HALF_CARRY_FLAG)}
        CarryFlag = ${this.gameboy.cpu.getFlag(CARRY_FLAG)}
        ---------------------- CPU ---------------------
        `);
    }

    public displayMemoryAddressValue(addr: number) {
        const value = this.gameboy.bus.readByte(addr);
        console.log(`
        ------------------------ RAM ADDRESS ---------------------
        Address = ${displayAsHex(addr)} (${addr})
        RAM[${displayAsHex(addr)}] = ${displayAsHex(value)} (${value})
        ------------------------ RAM ADDRESS ---------------------
        `);
    }

    public displayHelp() {
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

    public shouldShowDebugger() {
        return this.inDebuggerActive() || this.breakpointTriggered();
    }

    public inDebuggerActive() {
        return this.inDebuggerMode;
    }

    public showConsole() {
        // When true the reply will continue to prompt user for debugger commands
        // the NEXT and CONTINUE command will exit this loop
        let showDebugger = true;

        while (showDebugger) {
            const command = readlineSync.question(`(h for help, c for continue) [${displayAsHex(this.gameboy.cpu.PC)}]> `, {hideEchoBack: false});

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
            } else if (command === "h" || command === "help") {
                this.displayHelp();
            } else if (command.startsWith('readmem')) {
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                this.displayMemoryAddressValue(addr);
            } else if (command === "setbp" || command === "setbreakpoint") {
                console.log("SETTING A BREAKPOINT");
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                this.breakpoints.push(new AddressBreakpoint(addr));
                console.log(`Set new breakpoint at address 0x${displayAsHex(addr)}`);
            }
        }
    } 
}