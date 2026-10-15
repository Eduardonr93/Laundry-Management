---
name: design-md
description: Biblioteca de 84 sistemas de diseño (DESIGN.md) inspirados en sitios reales — Stripe, Apple, Linear, Notion, Vercel, Airbnb, Tesla, Spotify y más — con paletas, tipografía, espaciado, componentes y reglas de uso. Úsala cuando el usuario pida que la interfaz "se vea como" una marca o sitio, quiera rediseñar o dar estilo a pantallas/componentes, pida un look profesional/moderno/minimalista/oscuro, o necesite elegir una dirección visual (colores, fuentes, botones, tarjetas) para la app.
---

# DESIGN.md — sistemas de diseño de referencia

Colección de [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (licencia MIT, ver `LICENSE`).
Cada archivo en `designs/` describe el lenguaje visual de un sitio: tokens de color, escala tipográfica,
radios, sombras, espaciado, componentes y lo que se debe / no se debe hacer.

## Cómo usarla

1. **Elegir el diseño.**
   - Si el usuario nombra una marca o sitio, busca su `id` en `INDEX.md`.
   - Si describe un estilo ("oscuro y técnico", "limpio y corporativo", "cálido"), lee `INDEX.md`
     y propone 2–3 opciones con una línea de por qué encaja cada una; si el pedido es claro, elige tú.
2. **Leer el archivo completo** `designs/<id>.md` antes de escribir código. Son largos (20–45 KB):
   el frontmatter YAML trae los tokens (`colors`, `typography`, `rounded`, `spacing`, `components`) y el
   cuerpo explica atmósfera, jerarquía y reglas. Algunos archivos no tienen frontmatter y traen los tokens en el texto.
3. **Aplicarlo al proyecto.** Esta app es Angular + Tailwind CSS:
   - Lleva los colores y fuentes a la configuración de Tailwind o a variables CSS en `:root`
     (p. ej. `--color-primary`), y úsalos desde las clases en vez de valores sueltos.
   - Respeta escala tipográfica, pesos, `letter-spacing`, radios y sombras tal como los define el archivo.
   - Construye los componentes (botones, tarjetas, inputs, tablas, badges de estado) siguiendo la
     sección de componentes y las reglas do/don't.
4. **Adaptar, no copiar marcas.** Toma el lenguaje visual, no la identidad: no uses logotipos,
   nombres ni textos de la marca de referencia. Si una fuente es propietaria (Söhne, SF Pro, Universal Sans…),
   usa el fallback del propio archivo o una alternativa de Google Fonts similar (Inter, Geist, Manrope…).
5. **Contexto de la app.** Es un sistema de gestión de lavandería (órdenes, estados, clientes): prioriza
   legibilidad de tablas y formularios, contraste suficiente (WCAG AA) y estados claramente diferenciados
   por color *y* texto.

## Archivos

- `INDEX.md` — lista de todos los diseños por categoría con descripción corta.
- `designs/<id>.md` — el DESIGN.md de cada sitio.
- `LICENSE` — licencia MIT del repositorio original.
