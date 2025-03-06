
# SharedState Server

Python websocket server for real-time data sharing 

# Database setup

SharedState Server comes with a predefined service 
(src/server/services/items_service.py) based on mysql/sqlite3.

To make use of the built-in mysql support, follow steps below.
Alternatively, create a new service based on a different database.



### Mysql
```sh
mysql -u root -p 
```

### Mariadb
```sh
sudo mysql 
```

```sh
create user if not exists myuser@localhost identified by 'mypassword';
create database if not exists sharedstate;
grant all on sharedstate.* to myuser@localhost;
flush privileges;
```

# SharedState Server Config

Config is a json file. To use built-in database support, include
service definitions like below. 

```json
{
    "service": {"host": "0.0.0.0", "port": 9000},
    "services": [
        {
            "name": "items", "module": "items_service", 
            "config": {
                "db_type": "mysql",
                "db_name": "sharedstate",
                "db_table": "items",
                "db_host": "localhost",
                "db_user": "myuser",
                "db_password": "mypassord"
            }
        },
        {
            "name": "mitems", "module": "items_service", 
            "config": {
                "db_type": "sqlite",
                "db_name": "sharedstate",
                "db_table": "items"
            }
        }

    ]
}
```


### Python virtual environment setup

Python version >= 3.7

```sh
python3.8 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install .
sharedstate myconfig.json
```

