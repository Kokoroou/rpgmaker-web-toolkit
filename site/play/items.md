# Use several items at once

Using 30 potions or study books one by one takes a long time. When you choose a consumable item you hold more than one of in the item menu, the game first asks **how many** to use: 1 by default, up to 99.

## What happens

- **Items with direct effects** (healing, stat growth…) are applied once per item. They stop early when one more would do nothing, such as an actor at full HP. Unused items are kept.
- **Items that run a common event** run it that many times in a row. Only the last run shows its messages; the earlier ones also skip sounds and waits. Ten study books give ten times the effect and one message.

## When it asks nothing

Some items are always used one at a time, because running them several times in a row could break the game. These are items whose common event (or a common event it calls):

- shows choices, or asks for a number or an item;
- moves the player to another place, or starts a battle;
- opens a shop, the menu or the save screen;
- ends the game.

## Turn it off

⚙ → **Use several items at once** switches it on or off. The choice is remembered in this browser.

It works in any MV or MZ game that uses the standard item menu, including menus restyled by plugins.
