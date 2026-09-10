/**
 * Represents an Item with id and state properties.
 * @typedef {Object} Item
 * @property {string} id - The unique identifier of the item
 * @property {*} state - The state of the item
 */

/**
 * Represents changes to a collection of Items.
 * Changes are used both to express a request for change and to report changes after the fact.
 * @typedef {Object} Changes
 * @property {Map<string, Item>} [insert] - Map of Items to be inserted or replaced in the collection - <Item.id, Item>
 * @property {Set<string>} [remove] - Set of Item.id's to be removed from the collection
 * @property {boolean} [reset=false] - If true, reset all items of the collection (ignore remove), before inserting new items 
 */
