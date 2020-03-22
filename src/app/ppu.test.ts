
describe('ppu', () => {
  describe('LCDCStatus', () => {
    test('mode flag is initialized to NotInitialized', () => {
      const status = new LCDCStatus();
      expect(status.ModeFlag).toBe('NotInitialized');
    });

    test('parseLCDCStatusRegister', () => {
        const status = LCDCStatus.parseLCDCStatusRegister(0xCD); // 1011 1101
        expect(status.CoincidenceInterruptStatus).toBe(false);
        expect(status.OAMInterruptStatus).toBe(true);
        expect(status.VBlankInterruptStatus).toBe(true);
        expect(status.HBlankInterruptStatus).toBe(true);
        expect(status.ModeFlag).toBe('NotInitialized');
    });

    test('update', () => {
        const status = LCDCStatus.parseLCDCStatusRegister(0xCD);
        status.updateModeFlag(LCDC_MODES.VBlankPeriod);
        status.update(0x66); //0110 0110
        expect(status.ModeFlag).toBe(LCDC_MODES.VBlankPeriod);
        expect(status.CoincidenceInterruptStatus).toBe(true);
        expect(status.OAMInterruptStatus).toBe(true);
        expect(status.VBlankInterruptStatus).toBe(false);
        expect(status.HBlankInterruptStatus).toBe(false);
    });
  });
});