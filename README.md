
# DataCannon Server

Python websocket server for real-time data sharing 

# mysql/mariadb setup

```sh
mysql -u root -p 
```
Or, with mariadb

```sh
sudo mysql 
```

```sh
show databases;
use cannon;
show tables;
select * from items;
delete from items;
drop table items;
```

### Python virtual environment setup

```sh
python3.8 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install .
./dcserver
```

# DataCannon Client

JavaScript web client for DataCannon Server
