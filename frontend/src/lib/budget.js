/** The fixed budget categories from the API (A2), in its order, with display labels. */
export const BUDGET_CATEGORIES = [
  { value: 'food', label: 'Food' },
  { value: 'activities', label: 'Activities' },
  { value: 'transport', label: 'Transport' },
  { value: 'lodging', label: 'Lodging' },
  { value: 'other', label: 'Other' },
];

export function categoryLabel(value) {
  return BUDGET_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}
