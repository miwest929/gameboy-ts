import { displayAsHex } from './utils';

const ROM_BANK_SIZE_BYTES = 0x4000;

export abstract class MemoryBankController {
  protected romBanks: Uint8Array[];

  abstract WriteByte(addr: number, value: number);
  abstract ReadByte(addr: number);

  populateROMBanks(romBytes: Uint8Array, banksCount: number): Uint8Array[] {
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

export class MBC0 extends MemoryBankController {
    private romBytes: Uint8Array;

    constructor(romBytes: Uint8Array, romSize: number) {
        super();

        this.romBytes = romBytes;
    }

    WriteByte(addr: number, _value: number) {
        console.log(`ERROR: Attempt to write to address ${displayAsHex(addr)} in MBC0. This is not allowed`);
    }

    ReadByte(addr: number) {
        if ( addr > 0x7FFF) {
            console.log(`ERROR: Attempting to read from address ${addr} in MBC0. Outside valid address range`)
        }

        return this.romBytes[addr];
    }
}

export class MBC1 extends MemoryBankController {
   public currentROMBank: number;
   public currentRAMBank: number;
   public romSize: number;
   public ramSize: number;
   public hasBattery: boolean;

   constructor(romBytes: Uint8Array, romSize: number) {
     super();

     this.currentROMBank = 0;
     this.currentRAMBank = 0;
     this.romSize = romSize;
     this.romBanks = this.populateROMBanks(romBytes, romSize / 0x4000);
   }

   WriteByte(addr: number, value: number) {
     if (addr >= 0x2000 && addr <= 0x3FFF) {
        this.switchROMBank(value % 0x1F);
     } else if (addr >= 0x4000 && addr <= 0x5FFF) {
        this.switchRAMBank(value % 0x03);
     }
   }

   ReadByte(addr: number) {
	 if (addr < 0x4000) { // return from first ROM Bank
 		return this.romBanks[0][addr];
     } else if (addr >= 0x4000 && addr < 0x8000) { //Switchable ROM BANK
        return this.romBanks[this.currentROMBank][addr - 0x4000];
	 }
   }

   private switchROMBank(newROMBank: number) {
       if (newROMBank === 0x00) {
           newROMBank = 0x01;
       }
       console.log(`SWITCHING ROM BANKS to ${newROMBank}`);
       this.currentROMBank = newROMBank;
   }

   private switchRAMBank(newRAMBank: number) {
    console.log(`switch RAM bank to ${newRAMBank}`);
    throw new Error(`Switching RAM banks is not supported`);
    this.currentRAMBank = newRAMBank;
   }

}