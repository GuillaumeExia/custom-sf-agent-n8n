# UK Used-Car Buying FAQ (internal sales reference)

Scope: buying and owning a used car in the UK. Used by sales reps to answer customer questions.
Figures that change often (exact tax rates, live prices, pass rates) are NOT in this FAQ: use the
Autoza tools for those and say where the number came from.

---

## 1. Paperwork and checks before buying

**Q: What is a V5C?**
The V5C ("logbook") is the vehicle registration certificate issued by the DVLA. It names the
*registered keeper* (the person responsible for taxing the car), which is not necessarily the legal
owner. Check that the VIN and engine number on the V5C match the car, and that the seller's name
and address match the V5C. Never buy a car without a V5C (except brand-new keepers waiting for one).

**Q: What is a history check (HPI-style check)?**
A paid check against finance, police and insurance databases. It shows whether the car has
outstanding finance (it may still belong to a lender), is recorded as stolen, or was written off.
Recommend one on every private purchase; reputable dealers usually include it.

**Q: What do write-off categories mean?**
- Cat A: scrap entirely, never back on the road.
- Cat B: body shell must be crushed; parts may be salvaged. Never back on the road.
- Cat S: structural damage, repaired; can return to the road after repair. Must be declared.
- Cat N: non-structural damage, repaired; can return to the road. Must be declared.
Cat S/N cars are legal but usually worth less and can cost more to insure.

**Q: What should the customer check on a test drive?**
Cold start (no smoke, no warning lights staying on), smooth gear changes and clutch bite, straight
braking with no pulling, no knocks over bumps, all electrics working, tyre tread (legal minimum
1.6 mm across the central three-quarters), service book stamps matching the mileage.

**Q: How can mileage be checked?**
The public MOT history (gov.uk "check MOT history") lists the odometer reading at each test. A drop
or an unexplained flat period is a warning sign.

---

## 2. MOT

**Q: When does a car need its first MOT?**
In Great Britain, on the third anniversary of first registration, then every year. Northern Ireland
(DVA) tests from 4 years old. For an exact due date, use the `check_mot_due_date` tool.

**Q: Can you MOT early?**
Yes. You can test up to one month minus a day before the current certificate expires and keep the
same renewal date. Testing earlier resets the renewal date.

**Q: Is it legal to drive without an MOT?**
Only to a pre-booked MOT test or to a garage for repairs required to pass. Otherwise it's an offence
and usually invalidates insurance.

**Q: Will a high-mileage car pass its MOT?**
Mileage and age both affect first-time pass odds. Use the `mot_outlook` tool for the odds by age
and mileage (it's a fleet rate, not a prediction for one car).

---

## 3. Vehicle tax (VED)

**Q: How is car tax worked out?**
Three systems, based on the date of first registration:
- Before 1 March 2001: by engine size.
- 1 March 2001 – 31 March 2017: by CO2 emissions band.
- From 1 April 2017: a flat standard rate after the first year, plus the Expensive Car Supplement
  for cars with a list price over the threshold (£40,000; £50,000 for zero-emission cars first
  registered from 1 April 2025).
Electric cars pay vehicle tax from April 2025. For an exact figure, use `calculate_car_tax`.

**Q: Does tax transfer with the car?**
No. Tax does not transfer to a new keeper. The buyer must tax the car before driving it away; the
seller gets an automatic refund of full remaining months.

---

## 4. Clean air zones (ULEZ / CAZ)

**Q: Which cars are ULEZ compliant?**
As a rule of thumb: petrol cars meeting Euro 4 (most registered from 2006, many from 2001) and diesel
cars meeting Euro 6 (most registered from September 2015). Electric cars are compliant. Always check
the specific car; use `check_clean_air_zone` for compliance and daily charges.

**Q: Which zones charge private cars?**
London ULEZ, Bristol and Birmingham charge non-compliant private cars daily. Other English CAZs charge
only buses, taxis, vans or HGVs. Scottish Low Emission Zones issue penalties instead of a daily charge.

---

## 5. Consumer rights (buying from a dealer)

**Q: What rights does a customer have buying from a dealer?**
Under the Consumer Rights Act 2015, the car must be of satisfactory quality (allowing for age and
mileage), fit for purpose and as described.
- First 30 days: short-term right to reject for a full refund if a fault is found.
- Up to 6 months: a fault is presumed present at sale unless the dealer proves otherwise; the
  dealer gets one chance to repair or replace, then the customer can reject (a deduction for use may apply).
- After 6 months: the customer must show the fault was there at sale.
These rights don't cover normal wear and tear or faults pointed out before purchase.

**Q: And buying privately?**
Far fewer rights: the car must be as described and the seller must have the right to sell it.
"Sold as seen" is common.

**Q: Distance purchases?**
Cars bought online or by phone without visiting the dealer usually carry a 14-day cancellation right
(Consumer Contracts Regulations), in addition to the rights above.

---

## 6. Finance

**Q: What's the difference between HP and PCP?**
- HP (Hire Purchase): deposit, then fixed monthly payments; the customer owns the car after the last
  payment. Simple, usually higher monthly payments.
- PCP (Personal Contract Purchase): deposit, lower monthly payments, then a final "balloon" (the
  GFV, guaranteed future value). At the end: pay the balloon to keep the car, hand it back, or part-exchange.
  Mileage limits and condition charges apply.

**Q: Can a customer give a financed car back early?**
Under "voluntary termination", once 50% of the total amount payable has been paid (and the car has
been looked after), the customer can return it with nothing more to pay.

**Q: What's APR?**
The annual cost of borrowing including interest and mandatory fees, for comparing offers.
Our reps can't quote an APR without a formal quote from the lender.

---

## 7. Electric and hybrid cars

**Q: What should a customer check on a used EV?**
Battery state of health (ask for a report), remaining battery warranty (often 8 years / 100,000 miles),
charging cable(s) included, the rapid-charging speed the car supports, and whether the battery is
owned or leased.

**Q: Hybrid types?**
- Self-charging hybrid (HEV): small battery charged by the engine and braking; no plug.
- Plug-in hybrid (PHEV): bigger battery, plug-in charging, 20–50 miles of electric range typically.
- Mild hybrid (MHEV): small assist only; drives like a petrol/diesel car.

---

## 8. Reliability and prices

**Q: Is model X reliable?**
Use `get_model_reliability` (common faults, best and worst years, DVSA first-time MOT pass rates
age-matched to the national average). Say which data the answer came from.

**Q: What should model X cost?**
Use `get_uk_price_guide` (current dealer asking prices from live listings: median, lowest, highest).
These are asking prices, not trade valuations.

**Q: Can you find cars for sale / running costs for one listing?**
Use `search_used_cars`, then `ask_about_car` or `estimate_running_costs` with the listing URL or id.
Listing details come from the dealer's own advert, not an inspection.

---

## Not covered by this FAQ
Insurance quotes, specific finance offers, part-exchange valuations, warranty products, and anything
outside the UK. Say so rather than guessing.
