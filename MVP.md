# FINISH SOMETHING
what are the minimal specs i want for founderszoo?
ai should process daily review and user should have a short journal entry so the ai knows whats going on.

the idea and feeling im trying to mimick is how League of legends shows your rank, the next rank, and your end goal.
you know exactly how much lp you need to rank up and how many games that's going to be. makes playing a lot easier

# Finalized MVP Specs
first thing we can work on that is probably the most pain free is just the block categorization (for log modal and block display)
then we can just make the goal page and wire up the navigation. then hardcode in the goals.
maybe cut ai for this version?

need testing for 1 full day without having to wait for each hour. need to test review. need to test auto blocks

## improve existing system to match specs (low hanging fruit)
- [x] tags for block log menu: body, social, ops, work instead of "Read, Bored, Gym" add a new set of tags and make a new column in supabase for it.
- [x] visualize tags in the grid with an icon.
- [x] hardcode year, quarterly, monthly, weekly, daily goals
- [x] goal displayed at the top should cycle between the daily, weekly, monthly, quarterly, annual goal

## skeleton for goal system
- [x] display or navigate to goal view when you click the goal displayed at the top
- [x] lists 1-year, quarterly, monthly, weekly, daily goals
- [x] changes to hardcoded goals update Supabase
- [x] goal page i want the year goal to be at the top and then tabs for quarters.
- [ ] Set big event dates. so i want to set YC DUE DATE, end of week, end of month, quarter, etc. and then a Days until countdown

## integrate goals into daily ritual
- [ ] I WANT TO MAKE SOMETHING WHERE I CAN TRACK BAD THINGS
- [ ] need to create a repeatable workout system
- [ ] really need long term scheduled items. like vitamin d2 every week on thursday. or yc due feb 9
- [ ] create structure with auto-repeating blocks for lifestyle stuff like wind down, supplements, etc.
- [ ] each week has a "priority"
- [ ] DEV MODE: button to display review even though its not in the review window.

# Future Features
- [ ] future: AI adjusts daily targets and growth rate to keep user on track
- [ ] help me improve the numbers. slowly increase block sizes. progressive overload but for brain. can do it like a suggestion popup
- [ ] hardcoded hierarchy is AI context for daily review chats
- [ ] user can add a journal entry to surface new insights for the ai agent
- [ ] AI chat gives daily alignment summary and improvement suggestion for tomorrow with context of the game structure 
(1 more block of cold emails, 1 more cold email sent, switch phases on goal completed, etc.)
- [ ] days are scored based on what you did. hours are tallied up (if you have multiple blocks that say cold emails, it adds up those hours)
- [ ] life pillars pie chart. and numeric score with rounded square background with the color that will show up in heat map.
- [ ] goal page should display history of days in a github style heatmap. user can click each day to view
- [ ] daily review + performance updates milestones and trajectory over time. summary of today
