import type { EntityOut, EntityUpdate } from "../api/types/data-contracts";

// Preserve the create response when saving fields unavailable on EntityCreate.
export function capturePriceUpdate(item: EntityOut, purchasePrice: number, entityTypeId: string): EntityUpdate {
  return {
    ...item,
    entityTypeId: item.entityType?.id ?? entityTypeId,
    parentId: item.parent?.id ?? null,
    tagIds: item.tags.map(tag => tag.id),
    purchasePrice,
  };
}
