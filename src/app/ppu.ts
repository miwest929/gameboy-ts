//import { multiDimRepeat } from './utils';

const GB_SCREEN_WIDTH_IN_PX = 160;
const GB_SCREEN_HEIGHT_IN_PX = 144;

// NOTE: When the display is disabled, both VRAM and OAM are accessible at any time
const VRAM_ADDR_BEGIN = 0x8000;
const VRAM_ADDR_END = 0x9fff;
const VRAM_SIZE_BYTES = VRAM_ADDR_END - VRAM_ADDR_BEGIN + 1;
// Tiles are 8x8 pixels (64 pixels). Each pixel is 2 bits. In total, each tile takes up 128 bits (16 bytes).

// $FE00-FE9F
const OAM_ADDR_BEGIN = 0xfe00;
const OAM_ADDR_END = 0xfe9f;
const OAM_SIZE_BYTES = OAM_ADDR_END - OAM_ADDR_BEGIN + 1;

// Graphics Special Registers
const LCDC_ADDR = 0xff40;
const LCDC_ENABLED_FLAG = 0x80;
const LCDC_WINDOW_TILE_MAP_DISPLAY_SELECT_FLAG = 0x40;
const LCDC_WINDOW_DISPLAY_FLAG = 0x20;
const LCDC_BG_WINDOW_TILE_DATA_SELECT_FLAG = 0x10;
const LCDC_BG_TILE_MAP_DISPLAY_SELECT_FLAG = 0x08;
const LCDC_OBJ_SPRITE_SIZE_FLAG = 0x04;
const LCDC_OBJ_SPRITE_DISPLAY_FLAG = 0x02;
const LCDC_BG_WINDOW_DISPLAY_FLAG = 0x01;

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
const STAT_ADDR = 0xff41; // LCDC Status (R/W)
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

    static parseLCDCStatusRegister(value: number): LCDCStatus {
        /*const modeFlagValue = (0x03 & value);
        let modeFlag;
        if (modeFlagValue === 0)
          modeFlag = "HBlankPeriod";
        else if (modeFlagValue === 1)
          modeFlag = "VBlankPeriod";
        else if (modeFlagValue === 2)
          modeFlag = "SearchingOAMPeriod";
        else if (modeFlagValue === 3)
          modeFlag = "SearchingVRAMPeriod"; */
      
        let status = new LCDCStatus();
        status.RawValue = value;
        status.CoincidenceInterruptStatus = (value & 0x40) === 0x40;
        status.OAMInterruptStatus = (value & 0x20) === 0x20;
        status.VBlankInterruptStatus = (value & 0x10) === 0x10;
        status.HBlankInterruptStatus = (value & 0x08) === 0x08;
        status.CoincidenceFlag = (value & 0x04) === 0x04 ? 'LYC_EQ_LY' : 'LYC_NEQ_LY';
        status.ModeFlag = "NotInitialized";
        return status;
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

const SCROLLY_ADDR = 0xff42;
const SCROLLX_ADDR = 0xff43;
const LY_ADDR = 0xff44;
const LYC_ADDR = 0xff45;
const DMA_ADDR = 0xff46;

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
const BGP_ADDR = 0xff47;
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

// FF48 - OBP0 - Object Palette 0 Data (R/W) - Non CGB Mode Only
// This register assigns gray shades for sprite palette 0. It works exactly as BGP (FF47), except that the lower two bits aren't used because sprite data 00 is transparent.
const OBP0_ADDR = 0xff48;

// FF49 - OBP1 - Object Palette 1 Data (R/W) - Non CGB Mode Only
// This register assigns gray shades for sprite palette 1. It works exactly as BGP (FF47), except that the lower two bits aren't used because sprite data 00 is transparent.
const OBP1_ADDR = 0xff49;

const WINDOWY_ADDR = 0xff4a;
const WINDOWX_ADDR = 0xff4b;

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
class PPU {
    public buffer: number[][];
    private vram: Uint8Array;
    private oam: Uint8Array;

    // ppu special registers
    public LY: number;
    public LX: number;
    //public mode: LCDC_MODES;

    public SCROLL_Y: number;
    public SCROLL_X: number;
    public LCDC: number;
    public BGP_PALETTE_DATA: IBGP; // TODO: initialize to the correct initial value
    public LCDC_STATUS: LCDCStatus; // TODO: initialize to the correct initial value

    //public isDisplayOn: boolean; // derived from value of LCDC special register

    private clock: number;

    constructor() {
        this.buffer = multiDimRepeat<number>(0, GB_SCREEN_HEIGHT_IN_PX, GB_SCREEN_WIDTH_IN_PX);
        this.vram = new Uint8Array(VRAM_SIZE_BYTES);
        this.oam = new Uint8Array(OAM_SIZE_BYTES);
        this.clock = 0x00;
        this.LY = 0x00;
        this.LX = 0x00;
        this.LCDC = 0x00;
        this.LCDC_STATUS = null;
    }

    public getScreenBufferData(): IScreenBuffer {
        return {
            widthInPx: GB_SCREEN_WIDTH_IN_PX,
            heightInPx: GB_SCREEN_HEIGHT_IN_PX,
            data: this.buffer
        };
    }

    public writeSpecialRegister(addr: number, value: number) {
        if (addr === LCDC_ADDR) {
            console.log("WRITE TO the LCDC special register");
            this.LCDC = value;
        } else if (addr === LY_ADDR) {
            // ignore. this is a read-only register
        } else if (addr === SCROLLY_ADDR) {
            this.SCROLL_Y = value
        } else if (addr === SCROLLX_ADDR) {
            this.SCROLL_X = value;
        } else if (addr === STAT_ADDR) {
            if (this.LCDC_STATUS) {
              this.LCDC_STATUS.update(value);
            } else {
              this.LCDC_STATUS = LCDCStatus.parseLCDCStatusRegister(value);
            }
        } else if (addr === BGP_ADDR) {
            this.BGP_PALETTE_DATA = parseBGPRegister(value);
        } else if (addr === OBP0_ADDR) {
        } else if (addr === OBP1_ADDR) {
        } else {
            console.error(`Don't support writing to special reg at addr ${addr}`);
        }
    }

    public readFromSpecialRegister(addr: number): number {
        if (addr === LCDC_ADDR) {
            return this.LCDC;
        } else if (addr === LY_ADDR) {
            console.log("READ the LY special register");
            return this.LY;
        } else if (addr === SCROLLY_ADDR) {
            return this.SCROLL_Y;
        } else if (addr === SCROLLX_ADDR) {
            return this.SCROLL_X;
        } else if (addr === STAT_ADDR) {
            return this.LCDC_STATUS.RawValue;
        } else if (addr === BGP_ADDR) {
            return this.BGP_PALETTE_DATA.RawValue;
        } else if (addr === OBP0_ADDR) {
        } else if (addr === OBP1_ADDR) {
        } else {
            console.error(`Don't support reading to special reg at addr ${addr}`);
        }
    }

    public isDisplayOn(): boolean {
      return (this.LCDC & 0x80) === 0x80;
    }

    public step(cycles: number) {
      if (!this.isDisplayOn()) {
		this.LY = 0;
        this.clock = 456;
        
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
      } else if (this.LY >= 144) {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.VBlankPeriod);
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES) {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingOAMPeriod); 
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES - ACCESSING_VRAM_CYCLES) {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingVRAMPeriod);
      } else {
        this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
      }

      if (!this.isDisplayOn()) {
          return;
      }

      this.clock -= cycles;
      if (this.clock <= 0) {
          this.clock += 456;
          this.LY += 1;

          if (this.LY === 144) {

          } else if (this.LY > 153) {
              this.LY = 0;
          }

		  //Render scanline
		  if (this.LY < 144) {
              // render background scan line
              // render window scan line
              // render sprite (object) scan line
          }
      }
    }

    public writeToOAM(addr: number, value: number) {
        this.oam[addr] = value
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
}