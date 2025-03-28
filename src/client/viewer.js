/*
    Collection Viewer
*/

function item2string(item) {
    const {id, itv, data} = item;
    let data_txt = JSON.stringify(data);
    let itv_txt = (itv != undefined) ? JSON.stringify(itv) : "";
    let id_html = `<span class="id">${id}</span>`;
    let itv_html = `<span class="itv">${itv_txt}</span>`;
    let data_html = `<span class="data">${data_txt}</span>`;
    return `
        <div>
            <button id="delete">X</button>
            ${id_html}: ${itv_html} ${data_html}
        </div>`;
}


export class CollectionViewer {

    constructor(collection, elem, options={}) {
        this._coll = collection;
        this._elem = elem;
        this._handle = this._coll.add_callback(this._onchange.bind(this)); 

        // options
        let defaults = {
            delete:false,
            toString:item2string
        };
        this._options = {...defaults, ...options};

        /*
            Support delete
        */
        if (this._options.delete) {
            // listen for click events on root element
            elem.addEventListener("click", (e) => {
                // catch click event from delete button
                const deleteBtn = e.target.closest("#delete");
                if (deleteBtn) {
                    const listItem = deleteBtn.closest(".list-item");
                    if (listItem) {
                        this._coll.update({remove:[listItem.id]});
                        e.stopPropagation();
                    }
                }
            });
        }

        /*
            render initial state
        */ 
        const diffs = this._coll.get()
            .map(item => {
                return {id:item.id, new:item}
            });
        this._onchange(diffs);
    }

    _onchange(diffs) {
        const {toString} = this._options;
        for (let diff of diffs) {
            if (diff.new) {
                // add
                let node = this._elem.querySelector(`#${diff.id}`);
                if (node == null) {
                    node = document.createElement("div");
                    node.setAttribute("id", diff.id);
                    node.classList.add("list-item");
                    this._elem.appendChild(node);
                }
                node.innerHTML = toString(diff.new);
            } else if (diff.old) {
                // remove
                let node = this._elem.querySelector(`#${diff.id}`);
                if (node) {
                    node.parentNode.removeChild(node);
                }
            }
        }
    }
}
