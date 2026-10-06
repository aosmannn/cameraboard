# Database changes

Each file here is one change to the database, applied in order of its name. The first one is the whole current
schema; it is written to be safe to run on a database that already has it.

To change the database, add a new file named `<YYYYMMDDHHMMSS>_what_it_does.sql` here (write it so running it twice
is harmless), then push. Never edit a file that has already been applied.

`supabase/schema.sql` is the same thing joined into one file for pasting into the Supabase SQL Editor. Rebuild it
with `npm run db:schema`.
