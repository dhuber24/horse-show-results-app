--
-- PostgreSQL database dump
--

\restrict KlrUmyOjIYAL0Z0maEyO2uOLrAsfhAJnsTnqUwj1BRn7xSxk5pRnGjxZQQckbxm

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.shows DROP CONSTRAINT IF EXISTS shows_venue_id_fkey;
ALTER TABLE IF EXISTS ONLY public.shows DROP CONSTRAINT IF EXISTS shows_show_type_id_fkey;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.rings DROP CONSTRAINT IF EXISTS rings_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitors DROP CONSTRAINT IF EXISTS riders_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_horse_id_fkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_entry_id_fkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_class_id_fkey;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_result_id_fkey;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_changed_by_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_horse_id_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_class_id_fkey;
ALTER TABLE IF EXISTS ONLY public.divisions DROP CONSTRAINT IF EXISTS divisions_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_ring_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_division_id_fkey;
DROP INDEX IF EXISTS public.unique_back_number_per_class;
ALTER TABLE IF EXISTS ONLY public.venues DROP CONSTRAINT IF EXISTS venues_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.shows DROP CONSTRAINT IF EXISTS shows_pkey;
ALTER TABLE IF EXISTS ONLY public.show_types DROP CONSTRAINT IF EXISTS show_types_pkey;
ALTER TABLE IF EXISTS ONLY public.show_types DROP CONSTRAINT IF EXISTS show_types_code_key;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_rider_id_key;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_back_number_key;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_pkey;
ALTER TABLE IF EXISTS ONLY public.rings DROP CONSTRAINT IF EXISTS rings_pkey;
ALTER TABLE IF EXISTS ONLY public.exhibitors DROP CONSTRAINT IF EXISTS riders_pkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_rider_id_horse_id_key;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_pkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_pkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_class_id_place_entry_id_key;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_pkey;
ALTER TABLE IF EXISTS ONLY public.horses DROP CONSTRAINT IF EXISTS horses_pkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_pkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_class_id_rider_id_horse_id_key;
ALTER TABLE IF EXISTS ONLY public.divisions DROP CONSTRAINT IF EXISTS divisions_pkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_pkey;
DROP TABLE IF EXISTS public.venues;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.shows;
DROP TABLE IF EXISTS public.show_types;
DROP TABLE IF EXISTS public.show_entries;
DROP TABLE IF EXISTS public.rings;
DROP TABLE IF EXISTS public.results;
DROP TABLE IF EXISTS public.result_audit;
DROP TABLE IF EXISTS public.horses;
DROP TABLE IF EXISTS public.exhibitors;
DROP TABLE IF EXISTS public.exhibitor_horses;
DROP TABLE IF EXISTS public.entries;
DROP TABLE IF EXISTS public.divisions;
DROP TABLE IF EXISTS public.classes;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: classes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    ring_id uuid,
    division_id uuid,
    class_number text NOT NULL,
    class_name text NOT NULL,
    class_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.classes OWNER TO postgres;

--
-- Name: divisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.divisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.divisions OWNER TO postgres;

--
-- Name: entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    exhibitor_id uuid NOT NULL,
    horse_id uuid NOT NULL,
    back_number integer,
    status text DEFAULT 'ENTERED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.entries OWNER TO postgres;

--
-- Name: exhibitor_horses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exhibitor_horses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exhibitor_id uuid NOT NULL,
    horse_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.exhibitor_horses OWNER TO postgres;

--
-- Name: exhibitors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exhibitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);


ALTER TABLE public.exhibitors OWNER TO postgres;

--
-- Name: horses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.horses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_name text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.horses OWNER TO postgres;

--
-- Name: result_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.result_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    result_id uuid NOT NULL,
    changed_by uuid,
    old_place integer,
    new_place integer,
    changed_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.result_audit OWNER TO postgres;

--
-- Name: results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    place integer NOT NULL,
    is_tie boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT results_place_check CHECK ((place > 0))
);


ALTER TABLE public.results OWNER TO postgres;

--
-- Name: rings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.rings OWNER TO postgres;

--
-- Name: show_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.show_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    exhibitor_id uuid NOT NULL,
    back_number integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.show_entries OWNER TO postgres;

--
-- Name: show_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.show_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.show_types OWNER TO postgres;

--
-- Name: shows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    venue text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'DRAFT'::text NOT NULL,
    venue_id uuid,
    show_type_id uuid NOT NULL
);


ALTER TABLE public.shows OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hashed_password text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: venues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    state text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.venues OWNER TO postgres;

--
-- Data for Name: classes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classes (id, show_id, ring_id, division_id, class_number, class_name, class_date, status, created_at) FROM stdin;
\.


--
-- Data for Name: divisions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.divisions (id, show_id, name) FROM stdin;
\.


--
-- Data for Name: entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entries (id, class_id, exhibitor_id, horse_id, back_number, status, created_at) FROM stdin;
\.


--
-- Data for Name: exhibitor_horses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exhibitor_horses (id, exhibitor_id, horse_id, created_at) FROM stdin;
\.


--
-- Data for Name: exhibitors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exhibitors (id, full_name, created_at, user_id) FROM stdin;
\.


--
-- Data for Name: horses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.horses (id, name, owner_name, created_at) FROM stdin;
\.


--
-- Data for Name: result_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.result_audit (id, result_id, changed_by, old_place, new_place, changed_at) FROM stdin;
\.


--
-- Data for Name: results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.results (id, class_id, entry_id, place, is_tie, notes, created_at) FROM stdin;
\.


--
-- Data for Name: rings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rings (id, show_id, name) FROM stdin;
\.


--
-- Data for Name: show_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.show_entries (id, show_id, exhibitor_id, back_number, created_at) FROM stdin;
\.


--
-- Data for Name: show_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.show_types (id, code, name, config, created_at) FROM stdin;
4fcfe2b3-ac08-407f-89c4-dbccb406a2f1	APHA	American Paint Horse Association	{}	2026-04-19 16:11:45.833001+00
b8bf5c11-c80c-47ca-9b27-e3750436b8d7	AQHA	American Quarter Horse Association	{}	2026-04-19 16:11:45.833001+00
b613f047-817b-459a-b52f-e1de2674e4a1	OPEN	Open / Unaffiliated	{}	2026-04-19 16:11:45.833001+00
\.


--
-- Data for Name: shows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shows (id, name, venue, start_date, end_date, created_at, status, venue_id, show_type_id) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, role, full_name, email, created_at, hashed_password) FROM stdin;
fe461b7d-5381-4803-85ff-88da6c443509	ADMIN	Admin User	admin@horseshow.com	2026-04-13 20:55:37.130422+00	$2b$12$ULPWGreRoJbrPR41p/xlFeIkpCSOEq0.amvXzlPhFVpvgVxG9zhDu
68c3a45b-31d9-4fbc-8b5c-38e404ec9b09	SCOREKEEPER	Score Keeper	scorer@horseshow.com	2026-04-14 02:00:05.273128+00	$2b$12$LzvvczodthjelANbL2xw4uq7WY.DMfcqzDG90MOmaCh6vQmosIq4S
18d5ce01-d608-4f17-883f-a39a0b669b6b	EXHIBITOR	Dan Huber	danjhuber@hotmail.com	2026-04-14 02:10:26.263303+00	$2b$12$1zRG0w0PTUl5SUJ5fXyflewkgX4sdDR3EMX2.oLuDTo08AXIrpycu
d283c19e-4503-418c-8628-d4406410acc8	EXHIBITOR	Kristen Huber	kristen.huber17@gmail.com	2026-04-14 02:25:16.316627+00	$2b$12$l9GGrsd0Dv7SdwSEZYlyouNW0zrMFhgifgQkqaO2vbHUOnRq.SuMa
\.


--
-- Data for Name: venues; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.venues (id, name, address, city, state, created_at) FROM stdin;
02c0f54f-6f99-4168-8d85-52244d9daaf2	Fairgrounds Arena				2026-04-15 04:04:22.696138+00
e806ee77-d930-4c51-bbbe-81ef7ba60796	Dan's Barn		New Prague	MN	2026-04-19 12:59:16.094544+00
\.


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: divisions divisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_pkey PRIMARY KEY (id);


--
-- Name: entries entries_class_id_rider_id_horse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_class_id_rider_id_horse_id_key UNIQUE (class_id, exhibitor_id, horse_id);


--
-- Name: entries entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_pkey PRIMARY KEY (id);


--
-- Name: horses horses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.horses
    ADD CONSTRAINT horses_pkey PRIMARY KEY (id);


--
-- Name: result_audit result_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_pkey PRIMARY KEY (id);


--
-- Name: results results_class_id_place_entry_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_class_id_place_entry_id_key UNIQUE (class_id, place, entry_id);


--
-- Name: results results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_pkey PRIMARY KEY (id);


--
-- Name: exhibitor_horses rider_horses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_pkey PRIMARY KEY (id);


--
-- Name: exhibitor_horses rider_horses_rider_id_horse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_rider_id_horse_id_key UNIQUE (exhibitor_id, horse_id);


--
-- Name: exhibitors riders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitors
    ADD CONSTRAINT riders_pkey PRIMARY KEY (id);


--
-- Name: rings rings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rings
    ADD CONSTRAINT rings_pkey PRIMARY KEY (id);


--
-- Name: show_entries show_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_pkey PRIMARY KEY (id);


--
-- Name: show_entries show_entries_show_id_back_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_back_number_key UNIQUE (show_id, back_number);


--
-- Name: show_entries show_entries_show_id_rider_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_rider_id_key UNIQUE (show_id, exhibitor_id);


--
-- Name: show_types show_types_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_types
    ADD CONSTRAINT show_types_code_key UNIQUE (code);


--
-- Name: show_types show_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_types
    ADD CONSTRAINT show_types_pkey PRIMARY KEY (id);


--
-- Name: shows shows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: unique_back_number_per_class; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX unique_back_number_per_class ON public.entries USING btree (class_id, back_number) WHERE (back_number IS NOT NULL);


--
-- Name: classes classes_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(id);


--
-- Name: classes classes_ring_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_ring_id_fkey FOREIGN KEY (ring_id) REFERENCES public.rings(id);


--
-- Name: classes classes_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: divisions divisions_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: entries entries_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: entries entries_horse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_horse_id_fkey FOREIGN KEY (horse_id) REFERENCES public.horses(id);


--
-- Name: entries entries_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id);


--
-- Name: result_audit result_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: result_audit result_audit_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.results(id) ON DELETE CASCADE;


--
-- Name: results results_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: results results_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE;


--
-- Name: exhibitor_horses rider_horses_horse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_horse_id_fkey FOREIGN KEY (horse_id) REFERENCES public.horses(id) ON DELETE CASCADE;


--
-- Name: exhibitor_horses rider_horses_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id) ON DELETE CASCADE;


--
-- Name: exhibitors riders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitors
    ADD CONSTRAINT riders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: rings rings_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rings
    ADD CONSTRAINT rings_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: show_entries show_entries_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id);


--
-- Name: show_entries show_entries_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: shows shows_show_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_show_type_id_fkey FOREIGN KEY (show_type_id) REFERENCES public.show_types(id);


--
-- Name: shows shows_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- PostgreSQL database dump complete
--

\unrestrict KlrUmyOjIYAL0Z0maEyO2uOLrAsfhAJnsTnqUwj1BRn7xSxk5pRnGjxZQQckbxm

