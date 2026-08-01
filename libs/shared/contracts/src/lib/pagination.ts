export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PageMetadata {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResponse<TItem> extends PageMetadata {
  items: readonly TItem[];
}
