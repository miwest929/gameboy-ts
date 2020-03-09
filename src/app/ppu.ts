//import { multiDimRepeat } from './utils';

const GB_SCREEN_WIDTH_IN_PX = 160;
const GB_SCREEN_HEIGHT_IN_PX = 144;

const VRAM_ADDR_BEGIN = 0x8000;
const VRAM_ADDR_END = 0x9fff;
const VRAM_SIZE_BYTES = VRAM_ADDR_END - VRAM_ADDR_BEGIN + 1;

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

const STAT_ADDR = 0xff41;
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

class PPU {
    public buffer: number[][];
    private vram: Uint8Array;

    constructor() {
        this.buffer = multiDimRepeat<number>(0, GB_SCREEN_HEIGHT_IN_PX, GB_SCREEN_WIDTH_IN_PX);
        this.vram = new Uint8Array(VRAM_SIZE_BYTES);
    }

    getScreenBufferData(): IScreenBuffer {
        return {
            widthInPx: GB_SCREEN_WIDTH_IN_PX,
            heightInPx: GB_SCREEN_HEIGHT_IN_PX,
            data: this.buffer
        };
    }

    public write(addr: number, value: number) {
        this.vram[addr] = value
    }
}