# Varför det inte fanns några monster

Juulis startar vid lägerelden, `start_pos` (−128, −132) i chunk [0,0]. Den chunken är regionen startlagret: `sakert: true` och `monster_per_game: 0`. `syncBigWorldChunkMonsters` hoppar över säkra chunkar, så inget genereras runt hjälten.

Den täta flocken från fix #21 (ungefär 34 vargar i `spawnzoner.json`) ligger kvar vid Rungläntan, världens origo. Det är cirka 180 enheter bort. Kameran visar ungefär 20 enheter och monster aktiveras först inom 52, så flocken syns inte förrän man gått en bra stund rakt mot en punkt man inte ser. Den säkra cirkeln i `MonsterAI` satt dessutom runt origo (den gamla skalan, radie ~38), inte runt elden.

Mellanmarken hade 1–3 monster per chunk på 128×128 enheter, och vägar gallrade bort hälften av försöken. En kort promenad från lägret träffade därför ofta noll. Dödade monster sparades i `session.killed` och kom aldrig tillbaka.

## Fix

- En lägerflock (`lager:`) spawnas i världskoordinater runt elden, utanför en glänta på 14 enheter. Inre ringen syns från start. Den filtreras inte bort av legacy-chunk [1,1]. Flocken hålls utanför gläntan även när den jagar, så vargarna inte springer in i frågerutan vid elden. Man går ut till dem.
- Säker cirkel i stor värld utgår från elden, inte från origo. Rungläntans pack ligger kvar.
- Mellanmarken är 18–28 monster per chunk. Namngivna regioner multipliceras med `REGION_SPAWN_SCALE` (4). Noll-budget (byar) stannar tom.
- Vanliga monster respawnar efter 20 sekunder. Bossar och `quest:`-monster stannar döda.
