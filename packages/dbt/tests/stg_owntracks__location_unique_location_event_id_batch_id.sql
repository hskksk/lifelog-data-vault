-- Aligns with staging.owntracks_location_inbox: unique (location_event_id, batch_id).
-- Same payload in different batches shares location_event_id but must not duplicate per batch.
select
  location_event_id,
  batch_id,
  count(*) as duplicate_count
from {{ ref("stg_owntracks__location") }}
group by 1, 2
having count(*) > 1
