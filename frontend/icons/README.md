# Icon Customization Guide

## How to change icons

Replace the SVG files in the `icons/` folder. The app will automatically load the new icons.

## Available icon types

| File | Node Type | Default Color |
|------|-----------|--------------|
| `system.svg` | SYSTEM | `#6b7280` (gray) |
| `catalog.svg` | Catalog | `#3b82f6` (blue) |
| `database.svg` | Database | `#22c55e` (green) |
| `table.svg` | Table | `#6366f1` (indigo) |
| `view.svg` | View | `#a855f7` (purple) |
| `mv.svg` | Materialized View | `#f59e0b` (amber) |
| `function.svg` | Function | `#14b8a6` (teal) |
| `user.svg` | User | `#0ea5e9` (sky) |
| `role.svg` | Role | `#f97316` (orange) |

## SVG Tips

- Square viewBox recommended (e.g., `viewBox="0 0 24 24"`)
- Non-square SVGs are automatically centered and resized
- Stroke-style icons work well on dark themes
- Match stroke color to the node type's color for consistency
- Use `stroke-width="2"` or higher for visibility at small sizes
