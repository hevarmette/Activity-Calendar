import streamlit as st
import psycopg2


def get_connection():
    return psycopg2.connect(
        host=st.secrets["postgresql"]["host"],
        port=st.secrets["postgresql"]["port"],
        dbname=st.secrets["postgresql"]["database"],
        user=st.secrets["postgresql"]["username"],
        password=st.secrets["postgresql"]["password"],
    )
