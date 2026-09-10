/**
 * Represents an Item with an id and state property.
 * @typedef {Object} Item
 * @property {string} id - Item's unique identifier
 * @property {*} state - Item's state value
 */

/**
 * Represents changes to a collection of Items.
 * Changes are used to express a request for changes, or to report changes that were applied.
 * @typedef {Object} Changes
 * @property {Map<string, Item>} [insert] - Map of Items to be inserted or replaced in the collection - <Item.id, Item>
 * @property {Set<string>} [remove] - Set of Item.id's to be removed
 * @property {boolean} [reset=false] - If true, reset all items before insert and ignore remove. 
 */

/**
 * Event info passed as second parameter to eventify callbacks.
 * @typedef {Object} EventInfo
 * @property {Object} src - Source state object emitting the event
 * @property {string} name - Event name string (e.g. "change")
 * @property {number} count - Total times this event listener has been invoked
 * @property {boolean} init - True if this is an initial event (count == 0)
 * @property {Object} handle - Subscription handle object
 */
