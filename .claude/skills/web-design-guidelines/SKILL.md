---
name: web-design-guidelines
description: Revisa código de interfaz (HTML, CSS, componentes Angular/React/Vue) contra las Web Interface Guidelines de Vercel — accesibilidad, foco, formularios, animación, tipografía, rendimiento, modo oscuro, i18n y textos — y entrega hallazgos en formato `archivo:línea`. Úsala cuando pidan "revisa mi UI", "checa la accesibilidad", "audita el diseño", "revisa la UX" o "compara mi sitio con buenas prácticas".
metadata:
  author: vercel (adaptada)
  version: "1.0.0"
  argument-hint: <archivo-o-patrón>
---

# Web Interface Guidelines

Revisa archivos contra las reglas de `guidelines.md` (copia local de
[vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), licencia MIT).

## Cómo funciona

1. Si el usuario indicó archivos o un patrón, úsalos. Si no, pregunta cuáles revisar
   (o propón las plantillas y estilos principales del proyecto).
2. Lee `guidelines.md` completo.
3. Lee los archivos y revisa cada regla que aplique.
4. Entrega los hallazgos en el formato de salida de `guidelines.md`: agrupados por archivo, `archivo:línea - problema`.

## Adaptaciones

Las reglas vienen escritas pensando en React/Next.js. Traduce la intención al stack real:

- **Angular:** `<div (click)>` cuenta como `<div onClick>`; `routerLink` cuenta como `<Link>`;
  revisa `formControlName`/`[(ngModel)]` con su `<label for>`; usa `@for` con `track` y CDK virtual scroll
  para listas largas; las fechas y monedas pueden ir con `DatePipe`/`CurrencyPipe` con locale (equivalen a `Intl.*`).
  Las reglas de *Hydration Safety* solo aplican si hay SSR.
- **Vue / HTML plano:** misma idea: `@click` en elementos no interactivos, `<a>` para navegación, etc.
- **Textos en español:** no apliques *Title Case* (en español se usa mayúscula solo al inicio); usa comillas
  angulares o curvas (« » o “ ”) y `…`. El resto de reglas de redacción (voz activa, etiquetas específicas,
  mensajes de error con solución) sí aplica.
- Si una regla no aplica al proyecto (por ejemplo, safe areas en un panel de escritorio), omítela sin reportarla.

## Actualizar las reglas

Las reglas se guardan localmente para que no cambien sin revisión. Para actualizarlas, descarga
`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`, revisa el cambio
y reemplaza el contenido de `guidelines.md` (conserva el encabezado con la fuente y el commit).
