import type { EntityOut, EntityUpdate } from "../api/types/data-contracts";

// Preserve the create response when saving fields unavailable on EntityCreate.
export function captureDetailsUpdate(
  item: EntityOut,
  details: Partial<Pick<EntityUpdate, "purchasePrice" | "serialNumber" | "insured">>,
  entityTypeId: string
): EntityUpdate {
  return {
    ...item,
    entityTypeId: item.entityType?.id ?? entityTypeId,
    parentId: item.parent?.id ?? null,
    tagIds: item.tags.map(tag => tag.id),
    ...details,
  };
}
