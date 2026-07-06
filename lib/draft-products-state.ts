export function removeImportedDraftProduct<T extends { id: string }>(
  products: T[],
  productId: string,
) {
  return products.filter((product) => product.id !== productId);
}
