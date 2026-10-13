## Esencia

Octos rastrea sitios web y lee el estado de su SEO. El nombre viene de la noble senda óctuple budista: ocho tramos, y por eso ocho pétalos. La marca es serena, precisa y luminosa: ordena información técnica sin volverla fría.

- Escribe siempre «Octos»: O mayúscula y el resto en minúscula. Nunca «OCTOS» ni «octos» en títulos.
- Escribe en español neutro, en segunda persona y con frases cortas. Abre con un verbo concreto: «Rastrea», «Revisa», «Corrige».
- No uses signos de exclamación, emoji ni jerga innecesaria en la interfaz.

## Logo

- El símbolo es el loto de ocho pétalos (`assets/Logo/octos-loto.svg`). Cada pétalo es una cápsula de 20 × 46 unidades, girada 45° respecto al anterior, con un punto central de 12 unidades de diámetro en `petal-azul`.
- Pinta los pétalos en este orden, desde la cima y en sentido horario: `petal-celeste`, `petal-cielo`, `petal-azul`, `petal-indigo`, `petal-violeta`, `petal-lila`, `petal-agua`, `petal-menta`. No cambies el orden.
- Usa la versión a color sobre `surface`, `canvas` y los `wash-*`. Usa `octos-loto-azul.svg` cuando haya una sola tinta y `octos-loto-blanco.svg` sobre `octos-blue` o sobre fondos oscuros.
- El logotipo es el loto seguido de «Octos» en el estilo `display`, peso 800 y tracking −0.02em. Si el loto mide H de alto, el texto mide 0,7 H y la separación entre ambos es 0,25 H. Alinea el texto al centro vertical del loto.

## Espacio libre y tamaño mínimo

- Deja libre alrededor del símbolo, en cada lado, la mitad de su ancho.
- El loto a color no baja de 24 px de ancho; el logotipo no baja de 32 px de alto. Por debajo, usa `octos-loto-azul.svg`.

## Color

- La identidad son los ocho colores `petal-*`. Úsalos juntos en el loto y en bloques de color; no los uses para texto.
- Usa `octos-blue` para botones, enlaces y estados activos, con `on-octos-blue` encima. El texto azul va solo sobre `surface`.
- Escribe en `ink` sobre `surface` y `canvas`; deja `ink-muted` para apoyo y `hairline` para bordes.
- `petal-menta` acompaña a un estado correcto, nunca lo comunica solo: añade siempre una palabra o un ícono.

## Tipografía

- Los títulos van en Manrope (`display`), peso 800; `titulo-3` va en 700. Mantén el tracking negativo de cada estilo.
- Los textos y contenidos van en IBM Plex Sans (`text`): `cuerpo` y `cuerpo-grande` en 400, `etiqueta` en 600.
- No uses Manrope en párrafos ni IBM Plex Sans en títulos de marca.
- Escala: `display` 64/68, `titulo-1` 40/44, `titulo-2` 26/32, `titulo-3` 20/26, `cuerpo-grande` 18/28, `cuerpo` 15/24, `etiqueta` 13/18, `nota` 12/18.

## Ícono de app

- Dibuja el ícono como un squircle con `radius-app` y el loto al 80% del lado.
- Versión clara (`assets/Icono/octos-icono-claro.svg`): fondo blanco, `hairline` de borde y `shadow-icon` sobre fondos de atmósfera.
- Versión azul (`assets/Icono/octos-icono-azul.svg`): degradé diagonal de #63C4FF a #0A66FF con el loto en blanco.
- Usa una sola versión por pantalla.

## Atmósfera

- Las tarjetas hero llevan degradés radiales de dos o tres `wash-*` (`wash-celeste`, `wash-lila`, `wash-menta`, `wash-rosa`) en la parte alta, fundidos a `surface` hacia el 55% de la altura. Usa `radius-xl` y `shadow-card`.
- Los botones primarios usan `octos-blue`, `on-octos-blue`, `radius-md` y el estilo `etiqueta`.
- Separa tarjetas con `space-8` y rellénalas con `space-10` a los lados.

## Firma de Mamífero

- Octos es una creación de Mamífero. En todo material público de Octos (sitio, presentaciones, comunicados, este manual), incluye la línea «Una creación de Mamífero».
- Escribe la firma en el estilo `nota`, en `ink-muted`, bajo el logotipo o en el pie, alineada a la izquierda. Nunca la hagas más grande que el logotipo de Octos.
- Añade la firma en el pie de los informes exportados y en la pantalla «Acerca de» de la app.
- Si tienes el logotipo de Mamífero, ponlo a la derecha de la línea, con la altura del texto y su propio espacio libre. Si no lo tienes, escribe «Mamífero» en texto plano; no lo redibujes.
- La línea de firma va en una sola tinta (`ink-muted`). El logotipo de Mamífero conserva sus propios colores; no los mezcles con los `petal-*`.

## Usos incorrectos

- No estires, inclines ni gires el loto.
- No cambies los colores, el orden ni la proporción de los pétalos.
- No añadas sombras, contornos ni efectos al símbolo.
- No lo pongas sobre fondos con menos de 3:1 de contraste; usa la versión blanca o azul.
- No escribas el logotipo en otra tipografía.
