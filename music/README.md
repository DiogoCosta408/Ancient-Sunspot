# Music Folders

## Instructions

Add your MP3 files to these folders:

- **simulator/**: Music that plays during normal/free camera mode
- **pilot/**: Music that plays during pilot mode

The system will automatically shuffle and play all MP3 files in each folder based on the current mode.

### Important Notes

1. **Supported Format**: MP3 files only
2. **File Names**: Any name works, they will be auto-detected
3. **Playback**: Music loops through the playlist in shuffle mode
4. **Volume**: Default is 30%, adjustable in the code

### Example Structure

```
music/
├── simulator/
│   ├── ambient_space_1.mp3
│   ├── cosmic_journey.mp3
│   └── stellar_drift.mp3
└── pilot/
    ├── action_flight_1.mp3
    ├── hyperdrive.mp3
    └── warp_speed.mp3
```

Place your MP3 files in these folders and they will be automatically loaded!
