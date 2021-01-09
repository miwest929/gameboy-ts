"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PPU = exports.LCDC = exports.VRAM_SIZE_BYTES = exports.Address = void 0;
const utils_1 = require("./utils");
const emulator_1 = require("./emulator");
const GB_SCREEN_WIDTH_IN_PX = 160;
const GB_SCREEN_HEIGHT_IN_PX = 144;
var Address;
(function (Address) {
    Address[Address["VRAM_ADDR_BEGIN"] = 32768] = "VRAM_ADDR_BEGIN";
    Address[Address["VRAM_ADDR_END"] = 40959] = "VRAM_ADDR_END";
    Address[Address["OAM_ADDR_BEGIN"] = 65024] = "OAM_ADDR_BEGIN";
    Address[Address["OAM_ADDR_END"] = 65183] = "OAM_ADDR_END";
    Address[Address["LCDC_ADDR"] = 65344] = "LCDC_ADDR";
    Address[Address["STAT_ADDR"] = 65345] = "STAT_ADDR";
    Address[Address["SCROLLY_ADDR"] = 65346] = "SCROLLY_ADDR";
    Address[Address["SCROLLX_ADDR"] = 65347] = "SCROLLX_ADDR";
    Address[Address["LY_ADDR"] = 65348] = "LY_ADDR";
    Address[Address["LYC_ADDR"] = 65349] = "LYC_ADDR";
    Address[Address["DMA_ADDR"] = 65350] = "DMA_ADDR";
    // The window becomes visible (if enabled) when positions are set in range WX=0..166, WY=0..143.
    // A position of WX=7, WY=0 locates the window at upper left, it is then completely covering normal
    // background. WX values 0-6 and 166 are unreliable due to hardware bugs. If WX is set to 0, the window
    // will "stutter" horizontally when SCX changes. (Depending on SCX modulo 8, behavior is a little complicated
    // so you should try it yourself.)
    Address[Address["WINDOWY_ADDR"] = 65354] = "WINDOWY_ADDR";
    Address[Address["WINDOWX_ADDR"] = 65355] = "WINDOWX_ADDR";
    Address[Address["BGP_ADDR"] = 65351] = "BGP_ADDR";
    Address[Address["OBP0_ADDR"] = 65352] = "OBP0_ADDR";
    // This register assigns gray shades for sprite palette 0. It works
    // exactly as BGP (FF47), except that the lower two bits aren't used because sprite data 00 is transparent.
    Address[Address["OBP1_ADDR"] = 65353] = "OBP1_ADDR"; // FF49 - OBP1 - Object Palette 1 Data (R/W) - Non CGB Mode Only
    // This register assigns gray shades for sprite palette 1. It works exactly as BGP (FF47), except
    // that the lower two bits aren't used because sprite data 00 is transparent.
})(Address = exports.Address || (exports.Address = {}));
// NOTE: When the display is disabled, both VRAM and OAM are accessible at any time
exports.VRAM_SIZE_BYTES = Address.VRAM_ADDR_END - Address.VRAM_ADDR_BEGIN + 1;
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
    constructor(bytes) {
        if (bytes.length !== 4) {
            throw `Error: Each OAM Entry must be exactly 4 bytes. Received ${bytes.length} bytes instead`;
        }
        this.RawBytes = [bytes[0], bytes[1], bytes[2], bytes[3]];
    }
    x() {
        return this.RawBytes[1] - 8;
    }
    y() {
        return this.RawBytes[0] - 16;
    }
    tileId() {
        return this.RawBytes[2];
    }
    ObjBGPriority() {
        if ((this.RawBytes[3] & 0x80) === 0x80) {
            // OBJ Behind BG color 1-3
            return 1;
        }
        else {
            // OBJ Above BG
            return 0;
        }
    }
    isYFlipped() {
        return (this.RawBytes[3] & 0x40) === 0x40;
    }
    isXFlipped() {
        return (this.RawBytes[3] & 0x20) === 0x20;
    }
    // returns the address of this objs palette
    paletteAddr() {
        if ((this.RawBytes[3] & 0x10) === 0x10) {
            return 0xFF49;
        }
        else {
            return 0xFF48;
        }
    }
}
// Graphics Special Registers
const INITIAL_LCDC_VALUE = 0x91;
class LCDC {
    constructor() {
        this.RawValue = INITIAL_LCDC_VALUE;
    }
    /*
        7    6    5    4   |  3    2    1    0
        x    x    x    x   |  x    x    x    x
       0x80 0x40 0x20 0x10 | 0x08 0x04 0x02 0x01
    */
    update(value) {
        this.RawValue = value;
    }
    isDisplayOn() {
        return (this.RawValue & 0x80) === 0x80;
    }
    // @return number -> beginAddress  of the window tile map
    windowTileMapDisplayAddr() {
        if ((this.RawValue & 0x40) === 0x40) { // flag is on
            return 0x9C00; // endAddr = 0x9FFF
        }
        else {
            return 0x9800; // endAddr = 0x9BFF
        }
    }
    isWindowDisplayOn() {
        return (this.RawValue & 0x20) === 0x20;
    }
    backgroundAndWindowTileAddr() {
        if ((this.RawValue & 0x10) === 0x10) { // flag is on
            return 0x8000; // endAddr = 0x8FFF
        }
        else {
            return 0x8800; // endAddr = 0x97FF
        }
    }
    // just returns the start address since block length is constant
    backgroundTileMapDisplayAddr() {
        if ((this.RawValue & 0x08) === 0x08) { // flag is on
            return 0x9C00; // endAddr = 0x9FFF
        }
        else {
            return 0x9800; // endAddr = 0x9BFF
        }
    }
    // @return number: spriteWidth * spriteHeight
    objSpriteSize() {
        if ((this.RawValue & 0x04) === 0x04) { // flag is on
            // width=8, height=16
            return 128;
        }
        else {
            // width=8, height=8
            return 64;
        }
    }
    isObjSpriteDisplayOn() {
        return (this.RawValue & 0x02) === 0x02;
    }
    isBackgroundAndWindowDisplayOn() {
        return (this.RawValue & 0x01) === 0x01;
    }
}
exports.LCDC = LCDC;
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
    HBlankPeriod: "HBlankPeriod",
    VBlankPeriod: "VBlankPeriod",
    SearchingOAMPeriod: "SearchingOAMPeriod",
    SearchingVRAMPeriod: "SearchingVRAMPeriod" // 3
};
class LCDCStatus {
    constructor() {
        this.ModeFlag = "NotInitialized"; // the mode flag is not set initially. It needs to be set during PPU.step function
        this.RawValue = 0x00; // meaningless number when STATUS flag is not initialized
    }
    update(value) {
        // don't touch the ModeFlag and the CoincidenceFlag
        // so last 3 bits will remain untouched
        this.RawValue = (value & 0xF8) | (this.RawValue & 0x07);
        this.CoincidenceInterruptStatus = (value & 0x40) === 0x40;
        this.OAMInterruptStatus = (value & 0x20) === 0x20;
        this.VBlankInterruptStatus = (value & 0x10) === 0x10;
        this.HBlankInterruptStatus = (value & 0x08) === 0x08;
        this.CoincidenceFlag = (value & 0x04) === 0x04 ? 'LYC_EQ_LY' : 'LYC_NEQ_LY';
    }
    updateModeFlag(newModeFlag) {
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
const INITIAL_BGP_VALUE = 0xFC;
const INITIAL_SPRITE_VALUE = 0xFF;
// color 00 is transparant
class SpritePalette {
    // ColorZero: number; color zero is transparant
    constructor(initialValue) {
        this.update(initialValue);
    }
    update(value) {
        this.RawValue = value;
        this.parseSpriteRegister(value);
    }
    parseSpriteRegister(value) {
        this.ColorThree = (value & 0xC0) >> 6;
        this.ColorTwo = (value & 0x30) >> 4;
        this.ColorOne = (value & 0x0C) >> 2;
    }
}
var BGP_COLOR;
(function (BGP_COLOR) {
    BGP_COLOR[BGP_COLOR["White"] = 0] = "White";
    BGP_COLOR[BGP_COLOR["LightGray"] = 1] = "LightGray";
    BGP_COLOR[BGP_COLOR["DarkGray"] = 2] = "DarkGray";
    BGP_COLOR[BGP_COLOR["Black"] = 3] = "Black";
})(BGP_COLOR || (BGP_COLOR = {}));
// Possible shades
// 0  White
// 1  Light gray
// 2  Dark gray
// 3  Black
class BGPPalette {
    constructor(initialValue) {
        this.update(initialValue);
    }
    update(value) {
        this.RawValue = value;
        this.parseBGPRegister(value);
    }
    parseBGPRegister(value) {
        this.ColorThree = (value & 0xC0) >> 6;
        this.ColorTwo = (value & 0x30) >> 4;
        this.ColorOne = (value & 0x0C) >> 2;
        this.ColorZero = (value & 0x03);
    }
}
const ONE_LINE_SCAN_AND_BLANK_CYCLES = 456;
const ACCESSING_OAM_CYCLES = 80;
const ACCESSING_VRAM_CYCLES = 172;
// The V-Blank interrupt occurs ca. 59.7 times a second on a handheld Game Boy. This interrupt occurs at the beginning of the V-Blank period (LY=144)
class PPU {
    constructor() {
        this.pixels = utils_1.multiDimRepeat(0, 256, 256);
        this.vram = new Uint8Array(exports.VRAM_SIZE_BYTES);
        this.oam = new Uint8Array(OAM_SIZE_BYTES);
        this.clock = 0x00;
        this.LY = 0x00;
        this.LYC = 0x00;
        this.SCROLL_X = 0x00;
        this.SCROLL_Y = 0x00;
        this.WINDOWX = 0x00;
        this.WINDOWY = 0x00;
        this.LCDC_REGISTER = new LCDC();
        this.LCDC_STATUS = new LCDCStatus();
        this.BGP_PALETTE = new BGPPalette(INITIAL_BGP_VALUE);
        this.OBP0_PALETTE = new SpritePalette(INITIAL_SPRITE_VALUE);
        this.OBP1_PALETTE = new SpritePalette(INITIAL_SPRITE_VALUE);
    }
    setMemoryBus(bus) {
        this.bus = bus;
    }
    writeSpecialRegister(addr, value) {
        if (addr === Address.LCDC_ADDR) {
            //console.log("WRITE TO the LCDC special register");
            this.LCDC_REGISTER.update(value);
        }
        else if (addr === Address.LY_ADDR) {
            // ignore. this is a read-only register
            // attempting to write to LY register causes it's value to be reset
            this.LY = 0;
        }
        else if (addr === Address.SCROLLY_ADDR) {
            this.SCROLL_Y = value;
        }
        else if (addr === Address.SCROLLX_ADDR) {
            this.SCROLL_X = value;
        }
        else if (addr === Address.STAT_ADDR) {
            this.LCDC_STATUS.update(value);
        }
        else if (addr === Address.BGP_ADDR) {
            this.BGP_PALETTE.update(value);
        }
        else if (addr === Address.WINDOWY_ADDR) {
            this.WINDOWY = value;
        }
        else if (addr === Address.WINDOWX_ADDR) {
            this.WINDOWX = value;
        }
        else if (addr === Address.OBP0_ADDR) {
            this.OBP0_PALETTE.update(value);
        }
        else if (addr === Address.OBP1_ADDR) {
            this.OBP1_PALETTE.update(value);
        }
        else if (addr === Address.LYC_ADDR) {
            this.LYC = value;
        }
        else if (addr === Address.DMA_ADDR) {
            // const srcBeginAddr = (value << 8) | 0x00;
            // for (let offset = 0x00; offset <= 0x9F; offset++) {
            //     const value = this.bus.readByte(srcBeginAddr + offset);
            //     this.writeToOAM(0xFE00 + offset, value);
            // }
        }
        else {
            console.error(`Don't support writing to special reg at addr ${addr}`);
        }
    }
    readFromSpecialRegister(addr) {
        if (addr === Address.LCDC_ADDR) {
            return this.LCDC_REGISTER.RawValue;
        }
        else if (addr === Address.LY_ADDR) {
            return this.LY;
        }
        else if (addr === Address.SCROLLY_ADDR) {
            return this.SCROLL_Y;
        }
        else if (addr === Address.SCROLLX_ADDR) {
            return this.SCROLL_X;
        }
        else if (addr === Address.STAT_ADDR) {
            return this.LCDC_STATUS.RawValue;
        }
        else if (addr === Address.BGP_ADDR) {
            return this.BGP_PALETTE.RawValue;
        }
        else if (addr === Address.OBP0_ADDR) {
            return this.OBP0_PALETTE.RawValue;
        }
        else if (addr === Address.OBP1_ADDR) {
            return this.OBP1_PALETTE.RawValue;
        }
        else if (addr === Address.WINDOWY_ADDR) {
            return this.WINDOWY;
        }
        else if (addr === Address.WINDOWX_ADDR) {
            return this.WINDOWX;
        }
        else if (addr === Address.OBP0_ADDR) {
        }
        else if (addr === Address.OBP1_ADDR) {
        }
        else if (addr === Address.LYC_ADDR) {
            // LYC
            // When both LYC and LY registers are identical, the coincident bit in the
            // STAT register becomes set, and (if enabled) a STAT interrupt is requested
            return this.LYC;
        }
        else if (addr === Address.DMA_ADDR) {
            // WRITE-ONLY
            return 0x00;
        }
        else {
            console.error(`Don't support reading to special reg at addr ${addr}`);
        }
    }
    step(cycles) {
        if (!this.LCDC_REGISTER.isDisplayOn()) {
            this.LY = 0;
            this.clock = 456;
            this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
            return;
        }
        else if (this.LY >= 144) {
            this.LCDC_STATUS.updateModeFlag(LCDC_MODES.VBlankPeriod);
        }
        else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES) {
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
            //const visibleObjects = this.performOAMSearch(this.LY);
            //console.log(`OAM Search found these 10 visible objects: ${visibleObjects.join(', ')}`);
        }
        else if (this.clock >= ONE_LINE_SCAN_AND_BLANK_CYCLES - ACCESSING_OAM_CYCLES - ACCESSING_VRAM_CYCLES) {
            this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingVRAMPeriod);
        }
        else {
            this.LCDC_STATUS.updateModeFlag(LCDC_MODES.HBlankPeriod);
        }
        this.clock -= cycles;
        if (this.clock <= 0) {
            this.clock += 456;
            this.LY += 1;
            if (this.LY === 144) {
                // request VBLANK interrupt to occu
                this.LCDC_STATUS.updateModeFlag(LCDC_MODES.VBlankPeriod);
                this.bus.RequestInterrupt(emulator_1.Interrupt.VBLANK);
            }
            else if (this.LY > 153) {
                this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingVRAMPeriod);
                this.LY = 0;
            }
            if (this.LCDC_STATUS.CoincidenceInterruptStatus && this.LY === this.LYC) {
                this.LCDC_STATUS.CoincidenceFlag = 'LYC_EQ_LY';
                this.bus.RequestInterrupt(emulator_1.Interrupt.LCDCSTAT);
            }
            // Render scanline
            if (this.LY < 144) {
                this.LCDC_STATUS.updateModeFlag(LCDC_MODES.SearchingVRAMPeriod);
                /*
                  To simplify rendering we'll first render to the full 256x256 display
                  During LCD rendering is when we'll actually take SCX, SCY into account
                */
                // render background scan line
                this.renderBackgroundScanline();
                // render window scan line
                // render sprite (object) scan line
                if (this.LCDC_REGISTER.isObjSpriteDisplayOn()) {
                    // this.renderObjScanline();
                }
            }
        }
    }
    getScreenBuffer() {
        const buffer = utils_1.multiDimRepeat(0, GB_SCREEN_HEIGHT_IN_PX, GB_SCREEN_WIDTH_IN_PX);
        for (let iy = 0; iy < GB_SCREEN_HEIGHT_IN_PX; iy++) {
            for (let ix = 0; ix < GB_SCREEN_WIDTH_IN_PX; ix++) {
                const y = (this.SCROLL_Y + iy) % 256;
                const x = (this.SCROLL_X + ix) % 256;
                buffer[iy][ix] = this.pixels[y][x];
            }
        }
        return buffer;
    }
    writeToOAM(addr, value) {
        const normalizedAddr = addr & 0x009F; // make address between 0 and 159
        this.oam[normalizedAddr] = value;
    }
    readFromOAM(addr) {
        return this.oam[addr];
    }
    writeToVRAM(addr, value) {
        this.vram[addr] = value;
    }
    readFromVRAM(addr) {
        return this.vram[addr];
    }
    // Tiles are stored in two regions:
    //   Tiles are stored in $8000-97FF
    //   $8000-8FFF (sprites, bg, window display) tileId >= 0 and <= 255.
    //   $8800-97FF (background, window display) tileId between -128 and 127
    // Each tile (8x8) consumes 16 bytes (64 pixels at 2 bits/pixels)
    // Layout:
    //   Byte 0-1  First Line (Upper 8 pixels)
    //   Byte 2-3  Next Line
    // @return number[] -> 8 pixel colors for the correct line in the tile
    readScanlineFromTileData(tileId, lineOffset) {
        const baseTileAddr = this.LCDC_REGISTER.backgroundAndWindowTileAddr() + (tileId * 16);
        const baseTileDataAddr = baseTileAddr + lineOffset * 2;
        const lsbPixels = this.bus.readByte(baseTileDataAddr);
        const msbPixels = this.bus.readByte(baseTileDataAddr + 1);
        //console.log(`LY = ${this.LY}, tileId = ${tileId}, lineOffset = ${lineOffset}`);
        // 8 bits
        let pixel0 = ((msbPixels & 0x80) >> 6) | ((lsbPixels & 0x80) >> 7);
        let pixel1 = ((msbPixels & 0x40) >> 5) | ((lsbPixels & 0x40) >> 6);
        let pixel2 = ((msbPixels & 0x20) >> 4) | ((lsbPixels & 0x20) >> 5);
        let pixel3 = ((msbPixels & 0x10) >> 3) | ((lsbPixels & 0x10) >> 4);
        let pixel4 = ((msbPixels & 0x08) >> 2) | ((lsbPixels & 0x08) >> 3);
        let pixel5 = ((msbPixels & 0x04) >> 1) | ((lsbPixels & 0x04) >> 2);
        let pixel6 = (msbPixels & 0x02) | ((lsbPixels & 0x02) >> 1);
        let pixel7 = ((msbPixels & 0x01) << 1) | (lsbPixels & 0x01);
        // map the pixels value to their actual colors according to BGP register
        return [pixel0, pixel1, pixel2, pixel3, pixel4, pixel5, pixel6, pixel7];
    }
    /*
        This is necessary because bit-wise negation does not work as expected in Javascript
    */
    bitNegation(value) {
        let binaryString = value.toString(2);
        let negatedBinary = "";
        for (let i = 0; i < binaryString.length; i++) {
            negatedBinary += binaryString[i] === '1' ? '0' : '1';
        }
        return parseInt(negatedBinary, 2);
    }
    makeSigned(value, bytesCount) {
        let msbMask = 0x80;
        if (bytesCount === 2) {
            msbMask = 0x8000;
        }
        if ((value & msbMask) > 0) {
            // value is negative
            return -(this.bitNegation(value) + 1);
        }
        return value;
    }
    calculateTileId(tileMapStartAddr, tOffset) {
        const tileIdAddr = tileMapStartAddr + tOffset;
        let tileId = this.bus.readByte(tileIdAddr);
        const tileDataMode = this.LCDC_REGISTER.backgroundAndWindowTileAddr();
        if (tileDataMode === 0x8800) {
            let signedTileId = this.makeSigned(tileId, 1);
            if (signedTileId < 128) {
                return tileId + 256;
            }
        }
        return tileId;
    }
    renderScanline(tileMapStartAddr, lineOffset) {
        // Each background tile ix 8x8
        for (let tOffset = 0; tOffset < 32; tOffset++) {
            // const tileIdAddr = tileMapStartAddr + tOffset;
            const tileId = this.calculateTileId(tileMapStartAddr, tOffset); // this.bus.readByte(tileIdAddr);
            //const tileId = this.readFromVRAM(tileIdAddr - Address.VRAM_ADDR_BEGIN);
            const scanlinePixels = this.readScanlineFromTileData(tileId, lineOffset); // array of 8 pixels
            // "render" pixels in tileScanlineData
            // by "render" we write to this.pixels array
            for (let i = 0; i < 8; i++) {
                this.pixels[this.LY][tOffset * 8 + i] = scanlinePixels[i];
            }
        }
        // entire scanline has been "rendered"
    }
    /*
       Tile Maps have 32 chunks where each is 32 bytes long
       Each byte is a tileId. Since each actual tile is 8x8 each tileId spans 8 scanlines
    */
    renderBackgroundScanline() {
        // SCROLLX -> x position in the 256x256 pixels BG map 
        const bgTileMapAddr = this.LCDC_REGISTER.backgroundTileMapDisplayAddr();
        // this.LY is the scanline
        // this.LY + this.SCROLL_Y
        // const adjustedScreenY = this.LY + this.SCROLL_Y;
        // Every scanline begins with X = 0
        // The base address 
        const tileMapAddr = bgTileMapAddr + Math.floor(this.LY / 8) * 32; // bgTileMapAddr + adjustedScreenY;
        const lineOffset = this.LY % 8; // TODO: Verify this computation
        this.renderScanline(tileMapAddr, lineOffset);
    }
    // @param ly: number : the current scanline
    // @return number[] : Return the tileIds of up to 10 visible objects
    performOAMSearch(ly) {
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
exports.PPU = PPU;
