# Ginga · Força

Reproductor de sessions de força: cada exercici amb el seu vídeo, les sèries i el compte enrere del descans.

La sessió va dins l'enllaç (després del `#`) que envia Ginga al correu setmanal; aquesta pàgina no guarda ni rep cap dada.

## Rutes (`rutes/`)

Per a cada sessió de córrer o de bici, l'atleta tria d'on surt i la pàgina li proposa circuits que encaixen amb la
sessió (o les pistes d'atletisme més properes per a les sèries), amb el GPX i un mode per seguir-la amb el mòbil.
La sessió també va dins l'enllaç; els circuits els calcula openrouteservice a través del proxy de Ginga, que només
respon als enllaços signats. El codi font i les proves són al repositori `ginga` (`web/rutes/`): aquí només se'n
publica la còpia.
