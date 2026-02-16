export interface DictionaryItem {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDictionaryItemRequest {
  code: string;
  name: string;
}

export interface UpdateDictionaryItemRequest {
  code?: string;
  name?: string;
  is_active?: boolean;
}

export interface ReorderRequest {
  items: { id: string; sort_order: number }[];
}
