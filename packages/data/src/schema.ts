export const schemaSql = `
create table if not exists menu_items (
  id integer primary key,
  name text not null,
  category text not null,
  price_cents integer not null,
  prep_minutes integer not null
);

create table if not exists orders (
  id integer primary key,
  placed_at timestamp not null,
  status text not null check (status in ('delivered', 'cancelled')),
  cancel_reason text,
  prep_minutes integer not null,
  delivery_minutes integer,
  total_cents integer not null
);

create index if not exists orders_placed_at_idx on orders (placed_at);

create table if not exists order_items (
  order_id integer not null references orders (id),
  menu_item_id integer not null references menu_items (id),
  quantity integer not null,
  unit_price_cents integer not null,
  primary key (order_id, menu_item_id)
);

create table if not exists reviews (
  id integer primary key,
  order_id integer not null unique references orders (id),
  created_at timestamp not null,
  rating integer not null check (rating between 1 and 5),
  comment text
);

create table if not exists campaign_drafts (
  id serial primary key,
  created_at timestamp not null default now(),
  name text not null,
  goal text not null,
  discount_percent integer not null,
  weekdays integer[] not null,
  start_hour integer,
  end_hour integer,
  menu_item_ids integer[] not null,
  status text not null default 'pending_approval'
);
`
