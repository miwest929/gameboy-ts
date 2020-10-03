```
Please note this project is heavily under development and very much a work in progress. It requires extensive refactoring in order to achieve any semblance of production-ready code quality. It will get there.
```

## Architecture of this Emulator

This repo is just the emulator backend. On it's own nothing gets rendered. You need [gameboy-ts-web](https://github.com/miwest929/gameboy-ts-web) to see the rendered pixels in HTML5.

### Emulator Backend
`src/app/gameboy.ts` is the entry point for the emulator backend
You can run the backend indepdendently for developing and debugging reasons. But no graphics
will be rendered as that's handled solely by the frontend

