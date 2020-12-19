import { Gameboy, ZERO_FLAG, SUBTRACTION_FLAG, HALF_CARRY_FLAG, CARRY_FLAG } from "./emulator";
import { loadTextFile, displayAsHex } from "./utils";

export function loadBreakpoints(filename: string): Breakpoint[] {
    const breakpointsContents = loadTextFile(filename);

    if (breakpointsContents === "") {
        return [];
    }

    const lines = breakpointsContents.split("\n");
    return lines.map((l) => Breakpoint.from(l)).filter((bp) => bp);
}

abstract class Breakpoint {
    static from(command: string): Breakpoint {
      const words = command.toLowerCase().split(' ');
      const cmd = words[0];
      const args = words.slice(1);

      if (cmd === "address") {
        const addr = parseInt(args[0], 16);
        return new AddressBreakpoint(addr);
      } else if (cmd === "addresscond") {
        return AddressCondBreakpoint.from(args);
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

// trigger breakpoint when PC == <address> and <value-of-A-register> == <aValue>
export class AddressCondBreakpoint {
    public address: number;
    public aValue: number;

    constructor(address: number, aValue: number) {
        this.address = address;
        this.aValue = aValue;
    }
 
    public hasTriggered(gb: Gameboy): boolean {
        return gb.cpu.PC === this.address && gb.cpu.A === this.aValue;
    }
 
    public toString() {
        return `<AddressCondBreakpoint addr=${displayAsHex(this.address)}, aValue=${displayAsHex(this.aValue)}>`;
    }

    static from(args: string[]): AddressCondBreakpoint {
        const addr = parseInt(args[0], 16);
        const aValue = parseInt(args[0], 16);
        return new AddressCondBreakpoint(addr, aValue);
    }
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
       return `<AddressBreakpoint addr=${displayAsHex(this.address)}>`;
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

    private pastAddresses: number[];

    private readlineSync: any;

    private tracedAddresses: number[];

    constructor(gb: Gameboy, readlineSync?: any) {
        this.gameboy = gb;
        this.breakpoints = loadBreakpoints("./breakpoints");
        this.pastAddresses = [0x100]; // 0x100 is the address start executing..
        this.tracedAddresses = [];
        this.readlineSync = readlineSync;
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
        LY = ${displayAsHex(this.gameboy.ppu.LY)} (${this.gameboy.ppu.LY})
        WINDOWX = ${displayAsHex(this.gameboy.ppu.WINDOWX)} (${this.gameboy.ppu.WINDOWX})
        WINDOWY = ${displayAsHex(this.gameboy.ppu.WINDOWY)} (${this.gameboy.ppu.WINDOWY})
        ========================================================
        STAT = ${displayAsHex(this.gameboy.ppu.LCDC_STATUS.RawValue)}
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

    public pushCallAddress(callAddr: number) {
        this.pastAddresses.push(callAddr);
    }

    public popCallAddress() {
        this.pastAddresses.pop();
    }

    public inDebuggerActive() {
        return this.inDebuggerMode;
    }

    public recordAddress(cpu: any) {
        this.tracedAddresses.push(cpu.PC);
    }

    public showConsole() {
        // When true the reply will continue to prompt user for debugger commands
        // the NEXT and CONTINUE command will exit this loop
        let showDebugger = true;

        while (showDebugger) {
            const command = this.readlineSync.question(`(h for help, c for continue) [${displayAsHex(this.gameboy.cpu.PC)}]> `, {hideEchoBack: false});

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
                console.log(`[readmem] addr = ${displayAsHex(addr)}, addr (base10) = ${addr}`);
                this.displayMemoryAddressValue(addr);
            } else if (command.startsWith("setbp") || command.startsWith("setbreakpoint")) {
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                this.breakpoints.push(new AddressBreakpoint(addr));
                console.log(`Set new breakpoint at address 0x${displayAsHex(addr)}`);
            } else if (command.startsWith("delbp") || command.startsWith("removebreakpoint")) {
                const args = command.split(' ').slice(1);
                const addr = parseInt(args[0], 16);
                const idx = this.breakpoints.findIndex((bp) => { return (bp as AddressBreakpoint).address === addr; });
                if (idx !== -1) {
                    this.breakpoints.splice(idx, 1);
                    console.log(`Remove address breakpoint at address ${displayAsHex(addr)}`);
                }
            } else if (command === "empty" || command === "removeallbreakpoints") {
                this.breakpoints = [];
                console.log("Removed all breakpoints");
            } else if (command === "listbp") {
                console.log("Following are the Address breakpoints:");
                const addressBps = this.breakpoints.filter((bp) => bp.constructor.name === 'AddressBreakpoint');
                const messages = addressBps.map((bp) => `${bp.toString()}`);
                console.log(messages.join('\n'));
            } else if (command === "trace") {
                // Display list of call addresses. Every time a call happens its address will be traced
                //const formattedAddrs = this.pastAddresses.map((a) => displayAsHex(a));
                //console.log(`Address call stack: ${formattedAddrs.join(', ')}`);
                console.log(`Past 40 addresses:`);
                console.log( this.tracedAddresses.reverse().slice(0, 40).map((a) => displayAsHex(a)).join(", ") );
            }
        }
    } 
}