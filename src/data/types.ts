export type Product = {
  id: number;
  item_no?: number | null;
  name: string;
  category?: string | null;
  price_cents: number;
  is_available: number;
};

export type BillItem = {
  product_id: number;
  product_name: string;
  unit_price_cents: number;
  qty: number;
  line_total_cents: number;
};

export type Bill = {
  id: number;
  bill_no: string;
  subtotal_cents: number;
  discount_rate_bps: number;
  discount_cents: number;
  total_cents: number;
  created_at: string;
};
