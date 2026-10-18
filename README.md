# Ginga · Força

Reproductor de sessions de força: cada exercici amb el seu vídeo, les sèries i el compte enrere del descans.

La sessió va dins l'enllaç (després del `#`) que envia Ginga al correu setmanal; aquesta pàgina no guarda ni rep cap dada.

Si l'enllaç porta `g: 1` (sessió guiada; ara, només la de `ioga/`), la sessió passa sola com un vídeo: 8 s per
posar-se abans de cada exercici, les repeticions a temps, una veu guia que es pot apagar i Pausa (també amb l'OK del
comandament de la tele). El vídeo, sense so, es reprodueix quan comença l'explicació (la presentació de cada
exercici i «Un cop més») i després s'hi queda el fotograma del mig (la postura feta), sense botó de pausa. La veu són frases gravades amb una veu neural (`a`: la carpeta, amb `index.json`; ara, `ioga/veu/`, que
fa `python -m estiraments.veu`). Sense `g`, tot funciona com sempre.

## Ioga per corredors (`ioga/`)

Cada dia una sessió de ioga per corredors (una postura de cada fase d'`estiraments/ioga.yaml`), que s'obre guiada al
reproductor. No l'enllaça cap correu.

## Rutes (`rutes/`)

Per a cada sessió de córrer o de bici, l'atleta tria d'on surt i la pàgina li proposa circuits que encaixen amb la
sessió (o les pistes d'atletisme més properes per a les sèries), amb el GPX i un mode per seguir-la amb el mòbil.
La sessió també va dins l'enllaç; els circuits els calcula openrouteservice a través del proxy de Ginga, que només
respon als enllaços signats.

## No editis res aquí

Aquest repositori és només l'aparador públic (GitHub Pages). La font de totes les pàgines és al repositori privat
`ginga` (`web/`, `forca60/web/` i els logos de `marca/png/`), i el workflow `publica-web` hi copia tot sol el que es
fusiona a `main`. Un canvi fet directament aquí es perdria a la publicació següent.
