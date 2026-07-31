
# Communicating State Changes


- SharedState server
  1. receive update requests from clients
  2. process update requests towards ItemCollections
  3. broadcast state changes to subscribing clients.
  
  
- state sharing as replication of item collections
- to save bandwith it is necessary to communicate changes over the network
- particularly important when collections are large, with small changes 



## Changes

Changes to ItemCollections need to be communicated: 
- from client to server as part of an update request, and 
- from the server to the client as part of a state notification.

Changes involve items being **inserted**, **replaced**, or **deleted** from the collection.

Multiple changes concerning a single collection can be transferred and processed as a single batch.


We define changes as follows:

```javascript
{remove:[], insert:[], reset:false}
```

Parameters:
* `remove`: list of `id`'s (default: []). Items to be removed from the collection. 
* `insert`: list of [Items] (default: []). Items to be inserted into the collection. 
* `reset`: boolean (default: false). Reset collection. 

Rules:
- `remove` is performed ahead of `insert`.
- `insert` implies `replace` if Item with same `id` is already in the collection.
- `reset` implies that `remove` is ignored, and taht all Items in the collection are removed ahead of `insert`.


This design ensures that many types of changes can be communicated with little overhead.
The reset flag allow collections to be cleared without specifying the `id`'s of all Items


| UPDATE ARGUMENT                           | EFFECT                 |
|-------------------------------------------|------------------------|
| {remove:[], insert:[], reset:false}       | NOOP                   |
| {remove:[], insert:[...], reset:false}    | INSERT ITEMS           |
| {remove:[...], insert:[], reset:false}    | REMOVE ITEMS           |
| {remove:[...], insert:[...], reset:false} | REMOVE + INSERT ITEMS  |
| {reset:true}                              | RESET                  |
| {insert:[...], reset:true}                | RESET + INSERT ITEMS   |
|-------------------------------------------|------------------------|



## Update Requests

Update method on ItemCollection uses the `changes` argument 

```javascript
item_collection.update_items({remove:[], insert:[], reset:false})
```

## Change Notifications

- one message per collection, with batch of changes



## State Initialization

- start message
- sequence of n change messages
- end message




