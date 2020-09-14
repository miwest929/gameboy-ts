"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MBC1 = exports.MBC0 = exports.MemoryBankController = void 0;
const ROM_BANK_SIZE_BYTES = 0x4000;
class MemoryBankController {
    populateROMBanks(romBytes, banksCount) {
        let startBankAddr = 0x0000;
        this.romBanks = [];
        for (let i = 0; i < banksCount; i++) {
            const nextBank = romBytes.slice(startBankAddr, startBankAddr + 0x4000);
            this.romBanks.push(nextBank);
            startBankAddr += 0x4000;
        }
        return this.romBanks;
    }
}
exports.MemoryBankController = MemoryBankController;
class MBC0 extends MemoryBankController {
    constructor(romBytes, romSize) {
        super();
        this.romBytes = romBytes;
    }
    WriteByte(addr, _value) {
        console.log(`ERROR: Attempt to write to address ${addr} in MBC0. This is not allowed`);
    }
    ReadByte(addr) {
        if (addr > 0x7FFF) {
            console.log(`ERROR: Attempting to read from address ${addr} in MBC0. Outside valid address range`);
        }
        return this.romBytes[addr];
    }
}
exports.MBC0 = MBC0;
class MBC1 extends MemoryBankController {
    constructor(romBytes, romSize) {
        super();
        this.currentROMBank = 0;
        this.currentRAMBank = 0;
        this.romSize = romSize;
        this.romBanks = this.populateROMBanks(romBytes, romSize / 0x4000);
    }
    WriteByte(addr, value) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            this.switchROMBank(value % 0x1F);
        }
        else if (addr >= 0x4000 && addr <= 0x5FFF) {
            this.switchRAMBank(value % 0x03);
        }
    }
    ReadByte(addr) {
        if (addr < 0x4000) { // return from first ROM Bank
            return this.romBanks[0][addr];
        }
        else if (addr >= 0x4000 && addr < 0x8000) { //Switchable ROM BANK
            return this.romBanks[this.currentROMBank][addr - 0x4000];
        }
    }
    switchROMBank(newROMBank) {
        if (newROMBank === 0x00) {
            newROMBank = 0x01;
        }
        console.log(`SWITCHING ROM BANKS to ${newROMBank}`);
        this.currentROMBank = newROMBank;
    }
    switchRAMBank(newRAMBank) {
        console.log(`switch RAM bank to ${newRAMBank}`);
        throw new Error(`Switching RAM banks is not supported`);
        this.currentRAMBank = newRAMBank;
    }
}
exports.MBC1 = MBC1;