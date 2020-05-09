## Architecture of this Emulator

### Emulator Backend
`src/app/gameboy.ts` is the entry point for the emulator backend
You can run the backend indepdendently for developing and debugging reasons. But no graphics
will be rendered as that's handled solely by the frontend


### Emulator Frontend
`src/app/main.ts` is the entry point for the emulator frontend
When you're in the mood to fire up a gameboy and start mashing buttons you need to execute the emulator
through the frontend entrypoint.

This entrypoint will launch the backend automatically through a process fork. The frontend and backend will communicate
through a established IPC channel.