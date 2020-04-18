import { multiDimRepeat } from './utils';
import { MemoryBus, Interrupt } from './emulator';

/*class Screen {
    private buffer: number[][];

    constructor() {
        this.buffer = 
    }
}*/

const GB_SCREEN_WIDTH_IN_PX = 160;
const GB_SCREEN_HEIGHT_IN_PX = 144;

export enum Address {
    VRAM_ADDR_BEGIN = 0x8000,
    VRAM_ADDR_END = 0x9fff,
    OAM_ADDR_BEGIN = 0xfe00, // Object Attribute Memory are stored in addresses 0xFE00-0xFE9F
    OAM_ADDR_END = 0xfe9f,
    LCDC_ADDR = 0xff40,
    STAT_ADDR = 0xff41, // LCDC Status (R/W)
    SCROLLY_ADDR = 0xff42,
    SCROLLX_ADDR = 0xff43,
    LY_ADDR = 0xff44,
    LYC_ADDR = 0xff45,
    DMA_ADDR = 0xff46,

    // The window becomes visible (if enabled) when positions are set in range WX=0..166, WY=0..143.
    // A position of WX=7, WY=0 locates the window at upper left, it is then completely covering normal
    // background. WX values 0-6 and 166 are unreliable due to hardware bugs. If WX is set to 0, the window
    // will "stutter" horizontally when SCX changes. (Depending on SCX modulo 8, behavior is a little complicated
    // so you should try it yourself.)
    WINDOWY_ADDR = 0xff4a,
    WINDOWX_ADDR = 0xff4b,
    BGP_ADDR = 0xff47,
    OBP0_ADDR = 0xff48, // FF48 - OBP0 - Object Palette 0 Data (R/W) - Non CGB Mode Only
                        // This register assigns gray shades for sprite palette 0. It works
                        // exactly as BGP (FF47), except that the lower two bits aren't used because sprite data 00 is transparent.
    OBP1_ADDR = 0xff49 // FF49 - OBP1 - Object Palette 1 Data (R/W) - Non CGB Mode Only
                       // This register assigns gray shades for sprite palette 1. It works exactly as BGP (FF47), except
                       // that the lower two bits aren't used because sprite data 00 is transparent.
}

// NOTE: When the display is disabled, both VRAM and OAM are accessible at any time
export const VRAM_SIZE_BYTES = Address.VRAM_ADDR_END - Address.VRAM_ADDR_BEGIN + 1;
// Tiles are 8x8 pixels (64 pixels). Each pixel is 2 bits. In total, each tile takes up 128 bits (16 bytes).
// Layout of VRAM
/*
8000-87FF	Tile set #1: tiles 0-127
8800-8FFF	Tile set #1: tiles 128-255
            Tile set #0: tiles -1 to -128
9000-97FF	Tile set #0: tiles 0-127
9800-9BFF	Tile map #0
9C00-9FFF	Tile map #1
*/

const OAM_SIZE_BYTES = Address.OAM_ADDR_END - Address.OAM_ADDR_BEGIN + 1;

class OAMEntry {
    private RawBytes: number[];

    constructor(bytes: number[]) {
        if (bytes.length !== 4) {
           throw `Error: Each OAM Entry must be exactly 4 bytes. Received ${bytes.length} bytes instead`;
        }

        this.RawBytes = [bytes[0], bytes[1], bytes[2], bytes[3]]; 
    }

    public x(): number {
        return this.RawBytes[1] - 8;
    }

    public y(): number {
        return this.RawBytes[0] - 16;
    }

    public tileId(): number {
        return this.RawBytes[2];
    }

    public ObjBGPriority(): number {
        if ((this.RawBytes[3] & 0x80) === 0x80) {
            // OBJ Behind BG color 1-3
            return 1;
        } else {
            // OBJ Above BG
            return 0;
        }
    }

    public isYFlipped(): boolean {
        return (this.RawBytes[3] & 0x40) === 0x40;
    }

    public isXFlipped(): boolean {
        return (this.RawBytes[3] & 0x20) === 0x20;
    }

    // returns the address of this objs palette
    public paletteAddr(): number {
        if ((this.RawBytes[3] & 0x10) === 0x10) {
            return 0xFF49;
        } else {
            return 0xFF48;
        }
    }
}

// Graphics Special Registers

const INITIAL_LCDC_VALUE = 0x91;
export class LCDC {
    public RawValue: number;

    constructor() {
        this.RawValue = INITIAL_LCDC_VALUE;
    }
    /*
        7    6    5    4   |  3    2    1    0       
        x    x    x    x   |  x    x    x    x
       0x80 0x40 0x20 0x10 | 0x08 0x04 0x02 0x01
    */
    public update(value: number) {
        this.RawValue = value;
    }

    public isDisplayOn(): boolean { // bit 7
        return (this.RawValue & 0x80) === 0x80;
    }

    // @return number[] -> beginAddress and endAddress of the window tile map. Returned as two-element array
    public windowTileMapDisplayAddr(): number[] { // bit 6
        if ((this.RawValue & 0x40) === 0x40) { // flag is on
            return [0x9C00, 0x9FFF];
        } else {
            return [0x9800, 0x9BFF];
        }
    }

    public isWindowDisplayOn(): boolean { // bit 5
        return (this.RawValue & 0x20) === 0x20;
    }

    public backgroundAndWindowTileAddr(): number[] { // bit 4
        if ((this.RawValue & 0x10) === 0x10) { // flag is on
            return [0x8000, 0x8FFF];
        } else {
            return [0x8800, 0x97FF];
        }
    }

    public backgroundTileMapDisplayAddr(): number[] { // bit 3
        if ((this.RawValue & 0x08) === 0x08) { // flag is on
            return [0x9C00, 0x9FFF];
        } else {
            return [0x9800, 0x9BFF];
        }
    }

    // @return number: spriteWidth * spriteHeight
    public objSpriteSize(): number { // bit 2
        if ((this.RawValue & 0x04) === 0x04) { // flag is on
            // width=8, height=16
            return 128;
        } else {
            // width=8, height=8
            return 64;
        }
    }

    public isObjSpriteDisplayOn(): boolean { // bit 1
        return (this.RawValue & 0x02) === 0x02;
    }

    public isBackgroundAndWindowDisplayOn(): boolean { // bit 0
        return (this.RawValue & 0x01) === 0x01;
    }
}

// Bit 6 - LYC=LY Coincidence Interrupt (1=Enable) (Read/Write)
//  Bit 5 - Mode 2 OAM Interrupt         (1=Enable) (Read/Write)
//  Bit 4 - Mode 1 V-Blank Interrupt     (1=Enable) (Read/Write)
//  Bit 3 - Mode 0 H-Blank Interrupt     (1=Enable) (Read/Write)
//  Bit 2 - Coincidence Flag  (0:LYC<>LY, 1:LYC=LY) (Read Only)
//  Bit 1-0 - Mode Flag       (Mode 0-3, see below) (Read Only)
//            0: During H-Blank
//            1: During V-Blank
//            2: During Searching OAM
//            3: During Transferring Data to LCD Driver
const LCDC_MODES = {
    NotInitialized: "NotInitialized",
    HBlankPeriod: "HBlankPeriod",               // 0
    VBlankPeriod: "VBlankPeriod",               // 1
    SearchingOAMPeriod: "SearchingOAMPeriod",   // 2
    SearchingVRAMPeriod: "SearchingVRAMPeriod"  // 3
} as const;

type LCDC_MODES = typeof LCDC_MODES[keyof typeof LCDC_MODES];

class LCDCStatus {
    RawValue: number;
    CoincidenceInterruptStatus: boolean; // enabled = true
    OAMInterruptStatus: boolean; // enabled = true
    VBlankInterruptStatus: boolean; // enabled = true
    HBlankInterruptStatus: boolean; // enabled = true
    CoincidenceFlag: string; // 0:LYC<>LY (LYC_NEQ_LY), 1:LYC=LY ()   [READ_ONLY]
    ModeFlag: LCDC_MODES; // [READ_ONLY]

    constructor() {
        this.ModeFlag = "NotInitialized"; // the mode flag is not set initially. It needs to be set during PPU.step function
    }

    update(value: number) {
        // don't touch the ModeFlag and the CoincidenceFlag
        // so last 3 bits will remain untouched
        this.RawValue = (value & 0xF8) | (this.RawValue & 0x07);
        this.CoincidenceInterruptStatus = (value & 0x40) === 0x40;
        this.OAMInterruptStatus = (value & 0x20) === 0x20;
        this.VBlankInterruptStatus = (value & 0x10) === 0x10;
        this.HBlankInterruptStatus = (value & 0x08) === 0x08;
        this.CoincidenceFlag = (value & 0x04) === 0x04 ? 'LYC_EQ_LY' : 'LYC_NEQ_LY';
    }

    updateModeFlag(newModeFlag: LCDC_MODES) {
      this.ModeFlag = newModeFlag;
      let modeMask = 0;
      if (this.ModeFlag === 'VBlankPeriod')
        modeMask = 1;
      else if (this.ModeFlag === 'SearchingOAMPeriod')
          modeMask = 2;
      else if (this.ModeFlag === 'SearchingVRAMPeriod')
          modeMask = 3;    

      this.RawValue = (this.RawValue & 0xFC) | modeMask;
    }
}

// FF47 - BGP - BG Palette Data (R/W) - Non CGB Mode Only
// Bit 7-6 - Shade for Color Number 3
// Bit 5-4 - Shade for Color Number 2
// Bit 3-2 - Shade for Color Number 1
// Bit 1-0 - Shade for Color Number 0
// The four possible gray shades are:
//  0  White
//  1  Light gray
//  2  Dark gray
//  3  Black
const BGP_COLORS = {
    White: 0,
    LightGray: 1,
    DarkGray: 2,
    Black: 3
} as const;
type BGP_COLORS = typeof BGP_COLORS[keyof typeof BGP_COLORS];
interface IBGP {
    RawValue: number;
    ColorThreeShade: number,
    ColorTwoShade: number,
    ColorOneShade: number,
    ColorZeroShade: number
}
const parseBGPRegister = (value: number): IBGP => {
    const colorThree = (value & 0xC0) >> 6;
    const colorTwo = (value & 0x30) >> 4;
    const colorOne = (value & 0x0C) >> 2;
    const colorZero = (value & 0x03);

    return {
        RawValue: value,
        ColorThreeShade: colorThree,
        ColorTwoShade: colorTwo,
        ColorOneShade: colorOne,
        ColorZeroShade: colorZero,
    };
}

// Color codes
//  0b11 | white      |
const WHITE_PIXEL = 0x3;

// | 0b10 | dark-gray  |
const DARK_GRAY_PIXEL = 0x2;

// | 0b01 | light-gray |
const LIGHT_GRAY_PIXEL = 0x1;

// | 0b00 | black
const BLACK_PIXEL = 0x0;

// Every byte is 4 pixels. 2 bytes per row
// Each tile are 8x8 pixels. Each pixel occupies 2 bits. 128 bits / 8 = 16 bytes
// tiles are 16 bytes long

interface IScreenBuffer {
    widthInPx: number;
    heightInPx: number;
    data: number[][]
}

const ONE_LINE_SCAN_AND_BLANK_CYCLES = 456;
const ACCESSING_OAM_CYCLES = 80;
const ACCESSING_VRAM_CYCLES = 172;

// The V-Blank interrupt occurs ca. 59.7 times a second on a handheld Game Boy. This interrupt occurs at the beginning of the V-Blank period (LY=144)
export class PPU {
    public buffer: number[][];

    /*
      This memory contains OBJ Tiles (4KB), BG Tiles (4KB), BG Map (1KB), Window Map (1KB) 
      The LCDC register determines how vram is allocated to the 4 sections.
    */
    private vram: Uint8Array;


    public oam: Uint8Array;

    // ppu special registers
    public LY: number;
    public LX: number;
    public WINDOWY: number;
    public WINDOWX: number;
    public SCROLL_Y: number;
    public SCROLL_X: number;
    public LCDC_REGISTER: LCDC;
    public BGP_PALETTE_DATA: IBGP; // TODO: initialize to the correct initial value
    public LCDC_STATUS: LCDCStatus; // TODO: initialize to the correct initial value

    //public isDisplayOn: boolean; // derived from value of LCDC special register

    private clock: number;
    private bus: MemoryBus;

    constructor() {
        this.buffer = multiDimRepeat<number>(0, GB_SCREEN_HEIGHT_IN_PX, GB_SCREEN_WIDTH_IN_PX);
        this.vram = new Uint8Array(VRAM_SIZE_BYTES);
        this.oam = new Uint8Array(OAM_SIZE_BYTES);
        this.clock = 0x00;
        this.LY = 0x00;
        this.LX = 0x00;
        this.WINDOWX = 0x00;
        this.WINDOWY = 0x00;
        this.LCDC_REGISTER = new LCDC();
        this.LCDC_STATUS = new LCDCStatus();
    }

    public setMemoryBus(bus: MemoryBus) {
        this.bus = bus;
    }

    public getScreenBufferData(): IScreenBuffer {
        return {
            widthInPx: GB_SCREEN_WIDTH_IN_PX,
            heightInPx: GB_SCREEN_HEIGHT_IN_PX,
            data: this.buffer
        };
    }

    public writeSpecialRegister(addr: number, value: number) {
        if (addr === Address.LCDC_ADDR) {
            console.log("WRITE TO the LCDC special register");
            this.LCDC_REGISTER.update(value);
        } else if (addr === Address.LY_ADDR) {
            // ignore. this is a read-only register
            // attempting to write to LY register causes it's value to be reset
            this.LY = 0;
        } else if (addr === Address.SCROLLY_ADDR) {
            this.SCROLL_Y = value
        } else if (addr === Address.SCROLLX_ADDR) {
            this.SCROLL_X = value;
        } else if (addr === Address.STAT_ADDR) {
            this.LCDC_STATUS.update(value);
        } else if (addr === Address.BGP_ADDR) {
            this.BGP_PALETTE_DATA = parseBGPRegister(value);
        } else if (addr === Address.WINDOWY_ADDR) {
            this.WINDOWY = value;
        } else if (addr === Address.WINDOWX_ADDR) {
            this.WINDOWX = value;
        } else if (addr === Address.OBP0_ADDR) {
        } else if (addr === Address.OBP1_ADDR) {
        } else {
            console.error(`Don't support writing to special reg at addr ${addr}`);
        }
    }

    public readFromSpecialRegister(addr: number): number {
        if (addr === Address.LCDC_ADDR) {
            return this.LCDC_REGISTER.RawValue;
        } else if (addr === Address.LY_ADDR) {
            console.log("READ the LY special register");
            return this.LY;
        } else if (addr === Address.SCROLLY_ADDR) {
            return this.SCROLL_Y;
        } else if (addr === Address.SCROLLX_ADDR) {
            return this.SCROLL_X;
        } else if (addr === Address.STAT_ADDR) {
            return this.LCDC_STATUS.RawValue;
        } else if (addr === Address.BGP_ADDR) {
            return this.BGP_PALETTE_DATA.RawValue;
        } else if (addr === Address.WINDOWY_ADDR) {
            return this.WINDOWY;
        } else if (addr === Address.WINDOWX_ADDR) {
            return this.WINDOWX;
        } else if (addr === Address.OBP0_ADDR) {
        } else if (addr === Address.OBP1_ADDR) {
        } else {
            console.error(`Don't support reading to special reg at addr ${addr}`);
        }
    }

    public step(cycles: number) {
      if (!this.LCDC_REGISTER.isDisplayOn()) {
		this.LY = 0;
        this.clock = 456;
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
        return;
      } else if (this.LY >= 144) {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.VBlankPeriod);
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES) {
        // OAM Search is 20 cycles long. Happens at beginning of each scanline
        // For every line the PPU has to decide which Objects are visible in that line.
        // 40 objects total in system. It has to filter those objects to find those that are visible in that line
        // and put into an array of up to 10 sprites that are visible.
        // An object is visible when the following is true:
        // 1. oam.x != 0
        // 2. LY (current line we're rendering) + 16  >= oam.y
        // 3. LY + 16 < oam.y + h
        // The original gameboy has a wierd OAM Search CPU bug. If you do any 16-bit calculations with numbers between FE00 and FEFF
        // (even if you're not accessing the OAM RAM at all) will destroy the OAM RAM during OAM Search mode.
        // During this mode the CPU can't access the OAM RAM. If write nothing happens, If read then 0xFF is returned
        // But accessing VRAM during this mode is alright.
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingOAMPeriod);

        // perform OAM Search
        const visibleObjects = this.performOAMSearch(this.LY);
        console.log(`OAM Search found these 10 visible objects: ${visibleObjects.join(', ')}`);
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES - ACCESSING_VRAM_CYCLES) {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingVRAMPeriod);
      } else {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
      }

      this.clock -= cycles;
      if (this.clock <= 0) {
          this.clock += 456;
          this.LY += 1;

          if (this.LY === 144) {
            // request VBLANK interrupt to occu
            this.bus.RequestInterrupt(Interrupt.VBLANK);
          } else if (this.LY > 153) {
              this.LY = 0;
          }

		  // Render scanline
		  if (this.LY < 144) {
              // render background scan line
              // render window scan line

              // render sprite (object) scan line
              if (this.LCDC_REGISTER.isObjSpriteDisplayOn()) {
                 // this.renderObjScanline();
              }
          }
      }
    }

    public writeToOAM(addr: number, value: number) {
        const normalizedAddr = addr & 0x009F; // make address between 0 and 159
        this.oam[normalizedAddr] = value
    }

    public readFromOAM(addr: number) {
        return this.oam[addr];
    }

    public writeToVRAM(addr: number, value: number) {
        this.vram[addr] = value
    }

    public readFromVRAM(addr: number) {
        return this.vram[addr];
    }

    // @param ly: number : the current scanline
    // @return number[] : Return the tileIds of up to 10 visible objects
    private performOAMSearch(ly: number): number[] {
        // searches OAM RAM
        const visibleObjs = [];
        for (let objId = 39; objId >= 0; objId--) {
            const offset = 4 * objId;
            const oam = new OAMEntry([
                this.oam[offset],
                this.oam[offset + 1],
                this.oam[offset + 2],
                this.oam[offset + 3]
            ]);

            // check if obj is visible
            // TODO: This assumes that objects are 8x8. won't work when LCDC register declares all objs to be 8x16
            if (oam.x() !== 0 && (ly + 16) >= oam.y() && (ly + 16) < (oam.y() + 8)) {
                visibleObjs.push(oam.tileId());
            }
        }

        return visibleObjs;
    }
}