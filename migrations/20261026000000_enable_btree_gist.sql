-- Lets one GiST exclusion constraint combine equality on uuid columns with time-range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
