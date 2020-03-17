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

const STAT_ADDR = 0xff41; // LCDC Status (R/W)
const PPU_MODES = {
    HBlankPeriod: "HBlankPeriod",               // 0
    VBlankPeriod: "VBlankPeriod",               // 1
    SearchingOAMPeriod: "SearchingOAMPeriod",   // 2
    SearchingVRAMPeriod: "SearchingVRAMPeriod"  // 3
} as const;
type PPU_MODES = typeof PPU_MODES[keyof typeof PPU_MODES];

const SCROLLY_ADDR = 0xff42;
const SCROLLX_ADDR = 0xff43;
const LY_ADDR = 0xff44;
const LYC_ADDR = 0xff45;
const DMA_ADDR = 0xff46;
const BGP_ADDR = 0xff47;
const OBP0_ADDR = 0xff48;
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
    public mode: PPU_MODES;

    public SCROLL_Y: number;
    public SCROLL_X: number;
    public LCDC: number;
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
		this.mode = PPU_MODES.HBlankPeriod;
      } else if (this.LY >= 144) {
        this.mode = PPU_MODES.VBlankPeriod;
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES) {
        this.mode = PPU_MODES.SearchingOAMPeriod; 
      } else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES - ACCESSING_VRAM_CYCLES) {
        this.mode = PPU_MODES.SearchingVRAMPeriod;
      } else {
        this.mode = PPU_MODES.HBlankPeriod;
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