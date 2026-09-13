---
title: Tributary Demo
type: index
---

# Tributary Demo

Welcome to the demo workspace. This home page is mostly links plus executable
TSX cells.

- [[notes/hello|Hello]]
- [[items/task-1|Ship the demo]]

![[notes/hello]]

```js
const greeting = "Tributary renders TSX cells here."
```

```tsx
<strong>{greeting}</strong>
```

```js
import { workItems } from "@tributary/api"
const items = workItems()
```

```tsx
<ul>{items.map((w) => <li>{w.title}</li>)}</ul>
```
