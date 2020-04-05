import * as fs from 'fs';

export function loadRom(romName: string): Promise<Uint8Array> {
    return new Promise(function(resolve, reject) {
        $.ajax({
            url: `http://localhost:8081/${romName}.gb.base64`,
            method: 'GET',
            success: (data) => {
                const decoded: string = atob(data);
                const buffer = new Uint8Array(new ArrayBuffer(decoded.length));
                for (let i = 0; i < decoded.length; i++) {
                    buffer[i] = decoded.charCodeAt(i);
                }
                resolve(buffer);
            },
            error: (error) => {
                reject(error);
            }
         });
    });
}

export function loadRomFromFileSystem(romName: string): Uint8Array {
  console.log(`Reading ROM bytes for rom ${romName}`);
  const buffer = fs.readFileSync(romName);
  return Uint8Array.from(buffer);
}