# Form Field Label Structure

Form fields in the UI must use a `div.field` container with a `label htmlFor` associated to the target control by `id`.

Use a wrapping `label` only for simple checkbox/radio rows. Composite fields such as multi-selects, uploads, button groups, or checkbox groups must not use `label.field`; use `div.field` with explicit labels/spans and control associations.

