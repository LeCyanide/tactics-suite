# Kill icons

`icon_frag/` holds the game's kill-type icons (`icon_frag_torpedo.png`,
`icon_frag_burning.png`, …, and the generic `frags.png`) for the replay
viewer's battle panel. The installer ships this folder with the rest of
`seed/`; the app reads it in place (`killIcons` in
`electron/storage/db.ts`). Without the files, kills are named in words.

They are Wargaming's files, copied from a game install, not made here:

```sh
replay-dump datapack "<World_of_Warships>" <out> <build>
cp <out>/battle_hud/icon_frag/*.png seed/battle_hud/icon_frag/
```

(`replay-dump` is LeCyanide/replay-parser's tool; any copy of the client's
`gui/battle_hud/icon_frag/` works.) Refresh them when a patch changes them.
